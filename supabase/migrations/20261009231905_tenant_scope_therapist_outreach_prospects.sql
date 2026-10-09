-- Phase 25: establish tenant ownership on the service-only outreach staging table.
-- At rollout this database contained only the ValorWell tenant. A temporary
-- constant default backfills historical tuples without rewriting them (and
-- without modifying their updated_at timestamps). The default is then removed
-- so every future import must explicitly identify its tenant.
DO $scope$
DECLARE v_tenant uuid;
BEGIN
  IF (SELECT count(*) FROM public.tenants) <> 1 THEN
    RAISE EXCEPTION 'Tenant attribution aborted: project does not contain exactly one tenant';
  END IF;
  SELECT id INTO v_tenant FROM public.tenants WHERE name = 'ValorWell';
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Tenant attribution aborted: sole tenant is not ValorWell';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'therapist_outreach_prospects'
      AND column_name = 'tenant_id'
  ) THEN
    RAISE EXCEPTION 'tenant_id already exists; inspect migration history before retry';
  END IF;
  EXECUTE format(
    'ALTER TABLE public.therapist_outreach_prospects ADD COLUMN tenant_id uuid NOT NULL DEFAULT %L::uuid',
    v_tenant::text
  );
  EXECUTE 'ALTER TABLE public.therapist_outreach_prospects ALTER COLUMN tenant_id DROP DEFAULT';
END
$scope$;

ALTER TABLE public.therapist_outreach_prospects
  ADD CONSTRAINT therapist_outreach_prospects_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT;

CREATE INDEX therapist_outreach_prospects_tenant_created_idx
  ON public.therapist_outreach_prospects (tenant_id, created_at DESC, id);

-- Existing LinkedIn uniqueness previously applied across all tenants.
CREATE UNIQUE INDEX therapist_outreach_prospects_tenant_linkedin_unique_idx
  ON public.therapist_outreach_prospects (tenant_id, lower(btrim(linkedin_profile)))
  WHERE linkedin_profile IS NOT NULL
    AND btrim(linkedin_profile) <> ''
    AND linkedin_profile ILIKE '%linkedin.com/%';

DROP INDEX public.therapist_outreach_prospects_linkedin_profile_unique_idx;

-- Preserve normalization and enrichment behaviour, but deduplicate only
-- against other prospects belonging to the same tenant.
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
            outreach_contactable = p.outreach_contactable or new.outreach_contactable,
            outreach_exclusion_reason = case
              when p.outreach_contactable or new.outreach_contactable then null
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

COMMENT ON COLUMN public.therapist_outreach_prospects.tenant_id IS
  'Required tenant ownership. Historical rows assigned once to the sole existing ValorWell tenant on 2026-10-09. No default for subsequent imports.';

-- Staging contains contact information: keep access service-only, not public.
ALTER TABLE public.therapist_outreach_prospects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.therapist_outreach_prospects FROM anon, authenticated;
NOTIFY pgrst, 'reload schema';
