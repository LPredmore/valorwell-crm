-- Preserve existing do-not-contact exclusions when a duplicate imported row is marked contactable.
-- Tenant-local deduplication and all other source field enrichment remain unchanged.
CREATE OR REPLACE FUNCTION public.therapist_outreach_prospect_normalize_and_merge()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
    declare
      existing_id uuid;
    begin
      if new.licensed_states is null or jsonb_typeof(new.licensed_states) <> 'array' then
        new.licensed_states := '[]'::jsonb;
      end if;

      select coalesce(jsonb_agg(to_jsonb(s.state_code) order by s.state_code), '[]'::jsonb)
      into new.licensed_states
      from (
        select distinct upper(btrim(v.value)) as state_code
        from jsonb_array_elements_text(new.licensed_states) as v(value)
        where upper(btrim(v.value)) ~ '^[A-Z]{2}$'
        union
        select upper(btrim(new.state))
        where new.state is not null
          and upper(btrim(new.state)) ~ '^[A-Z]{2}$'
      ) s;

      if tg_op = 'INSERT' then
        select p.id
        into existing_id
        from public.therapist_outreach_prospects p
        where p.tenant_id = new.tenant_id
          and
          (
            new.linkedin_profile is not null
            and btrim(new.linkedin_profile) <> ''
            and new.linkedin_profile ilike '%linkedin.com/%'
            and lower(btrim(p.linkedin_profile)) = lower(btrim(new.linkedin_profile))
          )
          or
          (
            new.email is not null
            and new.email like '%@%'
            and lower(btrim(new.email)) not in ('not found','n/a','na','unknown')
            and new.first_name is not null
            and new.last_name is not null
            and lower(btrim(p.email)) = lower(btrim(new.email))
            and lower(btrim(p.first_name)) = lower(btrim(new.first_name))
            and lower(btrim(p.last_name)) = lower(btrim(new.last_name))
          )
        order by p.created_at asc, p.id asc
        limit 1;

        if existing_id is not null then
          update public.therapist_outreach_prospects p
          set
            licensed_states = (
              select coalesce(jsonb_agg(to_jsonb(u.state_code) order by u.state_code), '[]'::jsonb)
              from (
                select distinct upper(btrim(v.value)) as state_code
                from jsonb_array_elements_text(p.licensed_states) v(value)
                where upper(btrim(v.value)) ~ '^[A-Z]{2}$'
                union
                select distinct upper(btrim(v2.value))
                from jsonb_array_elements_text(new.licensed_states) v2(value)
                where upper(btrim(v2.value)) ~ '^[A-Z]{2}$'
              ) u
            ),
            license_type = case
              when p.license_type is null
                or btrim(p.license_type) = ''
                or lower(btrim(p.license_type)) in ('not found','n/a','na','unknown')
              then new.license_type
              else p.license_type
            end,
            email = case
              when p.email is null
                or btrim(p.email) = ''
                or lower(btrim(p.email)) in ('not found','n/a','na','unknown')
              then new.email
              else p.email
            end,
            phone = case
              when p.phone is null
                or btrim(p.phone) = ''
                or lower(btrim(p.phone)) in ('not found','n/a','na','unknown')
              then new.phone
              else p.phone
            end,
            linkedin_profile = case
              when p.linkedin_profile is null
                or btrim(p.linkedin_profile) = ''
                or lower(btrim(p.linkedin_profile)) in ('not found','n/a','na','unknown')
              then new.linkedin_profile
              else p.linkedin_profile
            end,
            outreach_contactable = p.outreach_contactable and new.outreach_contactable
              and p.outreach_exclusion_reason is null and new.outreach_exclusion_reason is null,
            outreach_exclusion_reason = case
              when p.outreach_contactable and new.outreach_contactable and p.outreach_exclusion_reason is null and new.outreach_exclusion_reason is null then null
              else coalesce(p.outreach_exclusion_reason, new.outreach_exclusion_reason)
            end,
            linkedin_connection_attempted =
              p.linkedin_connection_attempted or new.linkedin_connection_attempted,
            updated_at = now()
          where p.id = existing_id;

          return null;
        end if;
      end if;

      return new;
    end;
    $function$
;
