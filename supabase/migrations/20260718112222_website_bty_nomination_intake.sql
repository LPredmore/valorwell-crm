-- Narrow public Beyond The Yellow nomination intake.
-- Apply after 20260717225018. It is additive and hardens related RLS/anon ACLs.

insert into public.relationship_role_catalog (
  code,
  label,
  description,
  outreach_lane,
  applies_to,
  is_active
)
values (
  'bty_nominee',
  'BTY nominee',
  'Individual or organization nominated for Beyond The Yellow.',
  'bty_participation',
  'both',
  true
)
on conflict (code) do nothing;

create index if not exists website_submissions_bty_nomination_rate_idx
  on public.website_submissions (
    tenant_id,
    (pg_catalog.lower(pg_catalog.btrim(payload ->> 'email'))),
    submitted_at desc
  )
  where source_system = 'valorwell_website_bty_nomination'
    and submission_type = 'bty_submission';

-- The existing organization policies authorized any global staff/admin account.
-- Keep the same staff capability, but require membership in the row tenant.
drop policy if exists relationship_organizations_staff_admin
  on public.relationship_organizations;
create policy relationship_organizations_staff_admin
  on public.relationship_organizations
  for all
  to authenticated
  using (
    public.is_staff_or_admin((select auth.uid()))
    and public.is_tenant_member((select auth.uid()), tenant_id)
  )
  with check (
    public.is_staff_or_admin((select auth.uid()))
    and public.is_tenant_member((select auth.uid()), tenant_id)
  );

drop policy if exists relationship_organizations_owner_insert_guard
  on public.relationship_organizations;
create policy relationship_organizations_owner_insert_guard
  on public.relationship_organizations
  as restrictive
  for insert
  to authenticated
  with check (
    owner_profile_id is null
    or (
      public.is_staff_or_admin(owner_profile_id)
      and public.is_tenant_member(owner_profile_id, tenant_id)
      and exists (
        select 1
        from public.profiles as owner_profile
        where owner_profile.id = owner_profile_id
          and owner_profile.is_active is true
      )
    )
  );

drop policy if exists relationship_organizations_owner_update_guard
  on public.relationship_organizations;
create policy relationship_organizations_owner_update_guard
  on public.relationship_organizations
  as restrictive
  for update
  to authenticated
  using (true)
  with check (
    owner_profile_id is null
    or (
      public.is_staff_or_admin(owner_profile_id)
      and public.is_tenant_member(owner_profile_id, tenant_id)
      and exists (
        select 1
        from public.profiles as owner_profile
        where owner_profile.id = owner_profile_id
          and owner_profile.is_active is true
      )
    )
  );

drop policy if exists relationship_organization_roles_staff_admin
  on public.relationship_organization_roles;
create policy relationship_organization_roles_staff_admin
  on public.relationship_organization_roles
  for all
  to authenticated
  using (
    public.is_staff_or_admin((select auth.uid()))
    and public.is_tenant_member((select auth.uid()), tenant_id)
    and exists (
      select 1
      from public.relationship_organizations as organization
      where organization.id = relationship_organization_roles.organization_id
        and organization.tenant_id = relationship_organization_roles.tenant_id
    )
  )
  with check (
    public.is_staff_or_admin((select auth.uid()))
    and public.is_tenant_member((select auth.uid()), tenant_id)
    and exists (
      select 1
      from public.relationship_organizations as organization
      where organization.id = relationship_organization_roles.organization_id
        and organization.tenant_id = relationship_organization_roles.tenant_id
    )
  );

-- Ensure submission subject references cannot cross tenants through the
-- authenticated staff DML surface.
drop policy if exists website_submissions_staff_admin
  on public.website_submissions;
create policy website_submissions_staff_admin
  on public.website_submissions
  for all
  to authenticated
  using (
    public.is_staff_or_admin((select auth.uid()))
    and public.is_tenant_member((select auth.uid()), tenant_id)
    and (
      contact_id is null
      or exists (
        select 1
        from public.relationship_contacts as contact
        where contact.id = website_submissions.contact_id
          and contact.tenant_id = website_submissions.tenant_id
      )
    )
    and (
      organization_id is null
      or exists (
        select 1
        from public.relationship_organizations as organization
        where organization.id = website_submissions.organization_id
          and organization.tenant_id = website_submissions.tenant_id
      )
    )
    and (
      subject_contact_id is null
      or exists (
        select 1
        from public.relationship_contacts as subject_contact
        where subject_contact.id = website_submissions.subject_contact_id
          and subject_contact.tenant_id = website_submissions.tenant_id
      )
    )
    and (
      subject_organization_id is null
      or exists (
        select 1
        from public.relationship_organizations as subject_organization
        where subject_organization.id = website_submissions.subject_organization_id
          and subject_organization.tenant_id = website_submissions.tenant_id
      )
    )
  )
  with check (
    public.is_staff_or_admin((select auth.uid()))
    and public.is_tenant_member((select auth.uid()), tenant_id)
    and (
      contact_id is null
      or exists (
        select 1
        from public.relationship_contacts as contact
        where contact.id = website_submissions.contact_id
          and contact.tenant_id = website_submissions.tenant_id
      )
    )
    and (
      organization_id is null
      or exists (
        select 1
        from public.relationship_organizations as organization
        where organization.id = website_submissions.organization_id
          and organization.tenant_id = website_submissions.tenant_id
      )
    )
    and (
      subject_contact_id is null
      or exists (
        select 1
        from public.relationship_contacts as subject_contact
        where subject_contact.id = website_submissions.subject_contact_id
          and subject_contact.tenant_id = website_submissions.tenant_id
      )
    )
    and (
      subject_organization_id is null
      or exists (
        select 1
        from public.relationship_organizations as subject_organization
        where subject_organization.id = website_submissions.subject_organization_id
          and subject_organization.tenant_id = website_submissions.tenant_id
      )
    )
  );

create or replace function public.submit_website_bty_nomination(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tenant_id uuid;
  v_submission_key text;
  v_submission_source_key text;
  v_email text;
  v_nominator_source_key text;
  v_nominator_id uuid;
  v_source_nominator_id uuid;
  v_source_nominator_email text;
  v_email_nominator_id uuid;
  v_email_match_count integer;
  v_nominator_profile_id uuid;
  v_nominator_source text;
  v_nomination_type text;
  v_subject_name text;
  v_subject_link text;
  v_subject_veteran_affiliated boolean;
  v_subject_source_key text;
  v_subject_contact_id uuid;
  v_subject_organization_id uuid;
  v_existing_payload_matches boolean;
  v_key text;
  v_now timestamptz := pg_catalog.now();
begin
  if p_payload is null
     or pg_catalog.jsonb_typeof(p_payload) is distinct from 'object'
     or pg_catalog.octet_length(p_payload::text) > 16384 then
    raise exception using errcode = '22023', message = 'Invalid nomination.';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(p_payload) as supplied(key)
    where supplied.key <> all (array[
      'submission_key', 'nomination_type', 'subject_name', 'subject_link',
      'subject_veteran_affiliated', 'first_name', 'last_name', 'email',
      'phone', 'role_title', 'action', 'consent', 'source_page', 'user_agent'
    ]::text[])
  ) then
    raise exception using errcode = '22023', message = 'Invalid nomination.';
  end if;

  foreach v_key in array array[
    'submission_key', 'nomination_type', 'subject_name', 'subject_link',
    'first_name', 'last_name', 'email', 'phone', 'role_title', 'action',
    'source_page', 'user_agent'
  ]::text[] loop
    if p_payload ? v_key
       and p_payload -> v_key <> 'null'::jsonb
       and pg_catalog.jsonb_typeof(p_payload -> v_key) <> 'string' then
      raise exception using errcode = '22023', message = 'Invalid nomination.';
    end if;
  end loop;

  foreach v_key in array array['subject_veteran_affiliated', 'consent']::text[] loop
    if p_payload ? v_key
       and p_payload -> v_key <> 'null'::jsonb
       and pg_catalog.jsonb_typeof(p_payload -> v_key) <> 'boolean' then
      raise exception using errcode = '22023', message = 'Invalid nomination.';
    end if;
  end loop;

  v_submission_key := pg_catalog.btrim(p_payload ->> 'submission_key');
  v_nomination_type := pg_catalog.btrim(p_payload ->> 'nomination_type');
  v_subject_name := pg_catalog.btrim(p_payload ->> 'subject_name');
  v_subject_link := nullif(pg_catalog.btrim(p_payload ->> 'subject_link'), '');
  v_email := pg_catalog.lower(pg_catalog.btrim(p_payload ->> 'email'));

  if v_submission_key is null
     or pg_catalog.length(v_submission_key) not between 8 and 128
     or v_submission_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
     or v_nomination_type is null
     or v_nomination_type <> all (array['individual', 'organization']::text[])
     or nullif(v_subject_name, '') is null
     or pg_catalog.length(v_subject_name) > 200
     or pg_catalog.length(coalesce(v_subject_link, '')) > 500
     or (v_subject_link is not null and v_subject_link !~* '^https://[^[:space:]]+$')
     or p_payload -> 'subject_veteran_affiliated' is null
     or p_payload -> 'subject_veteran_affiliated' = 'null'::jsonb
     or pg_catalog.jsonb_typeof(p_payload -> 'subject_veteran_affiliated') <> 'boolean'
     or nullif(pg_catalog.btrim(p_payload ->> 'first_name'), '') is null
     or pg_catalog.length(pg_catalog.btrim(p_payload ->> 'first_name')) > 100
     or nullif(pg_catalog.btrim(p_payload ->> 'last_name'), '') is null
     or pg_catalog.length(pg_catalog.btrim(p_payload ->> 'last_name')) > 100
     or v_email is null
     or pg_catalog.length(v_email) > 254
     or v_email !~ $email$^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$$email$
     or pg_catalog.length(coalesce(pg_catalog.btrim(p_payload ->> 'phone'), '')) > 50
     or pg_catalog.length(coalesce(pg_catalog.btrim(p_payload ->> 'role_title'), '')) > 150
     or pg_catalog.length(coalesce(pg_catalog.btrim(p_payload ->> 'source_page'), '')) > 500
     or pg_catalog.length(coalesce(pg_catalog.btrim(p_payload ->> 'user_agent'), '')) > 500
     or nullif(pg_catalog.btrim(p_payload ->> 'action'), '') is null
     or pg_catalog.length(pg_catalog.btrim(p_payload ->> 'action')) not between 10 and 4000
     or p_payload -> 'consent' is null
     or p_payload -> 'consent' = 'null'::jsonb
     or pg_catalog.jsonb_typeof(p_payload -> 'consent') <> 'boolean'
     or not (p_payload ->> 'consent')::boolean then
    raise exception using errcode = '22023', message = 'Invalid nomination.';
  end if;

  v_subject_veteran_affiliated := (p_payload ->> 'subject_veteran_affiliated')::boolean;
  v_tenant_id := public.website_intake_tenant_id();
  if v_tenant_id is null then
    raise exception using errcode = 'P0001', message = 'Unable to submit nomination right now.';
  end if;

  -- Lock order is always request key, normalized nominator email, then subject.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('bty-nomination-request:' || v_submission_key, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('bty-nomination-email:' || v_email, 0)
  );

  v_submission_source_key := 'request:' || v_submission_key;
  select
    submission.payload = p_payload
      and pg_catalog.lower(pg_catalog.btrim(submission.payload ->> 'email')) = v_email
  into v_existing_payload_matches
  from public.website_submissions as submission
  where submission.tenant_id = v_tenant_id
    and submission.source_system = 'valorwell_website_bty_nomination'
    and submission.source_record_key = v_submission_source_key;

  if found then
    if not coalesce(v_existing_payload_matches, false) then
      raise exception using
        errcode = 'P0001',
        message = 'Unable to submit nomination right now.';
    end if;
    return pg_catalog.jsonb_build_object('ok', true);
  end if;

  if (
    select pg_catalog.count(distinct submission.source_record_key)
    from public.website_submissions as submission
    where submission.tenant_id = v_tenant_id
      and submission.source_system = 'valorwell_website_bty_nomination'
      and submission.submission_type = 'bty_submission'
      and submission.submitted_at >= v_now - interval '1 hour'
      and pg_catalog.lower(pg_catalog.btrim(submission.payload ->> 'email')) = v_email
  ) >= 5 then
    raise exception using
      errcode = 'P0001',
      message = 'Unable to submit nomination right now.';
  end if;

  v_nominator_source_key := 'email:' || pg_catalog.md5(v_email);

  select
    contact.id,
    pg_catalog.lower(pg_catalog.btrim(contact.email))
  into v_source_nominator_id, v_source_nominator_email
  from public.relationship_contacts as contact
  where contact.tenant_id = v_tenant_id
    and contact.source = 'valorwell_website_bty_nomination'
    and contact.source_record_key = v_nominator_source_key
  limit 1;

  select
    pg_catalog.count(*),
    (pg_catalog.array_agg(contact.id order by contact.id))[1]
  into v_email_match_count, v_email_nominator_id
  from public.relationship_contacts as contact
  where contact.tenant_id = v_tenant_id
    and pg_catalog.lower(pg_catalog.btrim(contact.email)) = v_email;

  if v_email_match_count > 1
     or (
       v_source_nominator_id is not null
       and v_source_nominator_email is distinct from v_email
     )
     or (
       v_source_nominator_id is not null
       and v_email_nominator_id is not null
       and v_source_nominator_id <> v_email_nominator_id
     ) then
    insert into public.website_submissions (
      tenant_id,
      submission_type,
      original_lane,
      normalized_lane,
      source_system,
      source_record_key,
      payload,
      consent,
      source_page,
      user_agent,
      status,
      submitted_at
    ) values (
      v_tenant_id,
      'bty_submission',
      'nominate',
      'bty_participation',
      'valorwell_website_bty_nomination',
      v_submission_source_key,
      p_payload,
      true,
      coalesce(nullif(pg_catalog.btrim(p_payload ->> 'source_page'), ''), '/beyondtheyellow'),
      nullif(pg_catalog.btrim(p_payload ->> 'user_agent'), ''),
      'reviewing',
      v_now
    );

    return pg_catalog.jsonb_build_object('ok', true);
  end if;

  v_nominator_id := coalesce(v_source_nominator_id, v_email_nominator_id);

  if v_nominator_id is null then
    insert into public.relationship_contacts (
      tenant_id,
      profile_id,
      first_name,
      last_name,
      email,
      phone,
      veteran_affiliation,
      outreach_status,
      review_state,
      source,
      source_record_key,
      metadata
    ) values (
      v_tenant_id,
      null,
      pg_catalog.btrim(p_payload ->> 'first_name'),
      pg_catalog.btrim(p_payload ->> 'last_name'),
      v_email,
      nullif(pg_catalog.btrim(p_payload ->> 'phone'), ''),
      'unknown',
      'new',
      'review_needed',
      'valorwell_website_bty_nomination',
      v_nominator_source_key,
      pg_catalog.jsonb_build_object(
        'first_bty_nomination_at', v_now,
        'latest_bty_nomination_at', v_now
      )
    )
    returning id into v_nominator_id;
  else
    select contact.profile_id, contact.source
    into v_nominator_profile_id, v_nominator_source
    from public.relationship_contacts as contact
    where contact.id = v_nominator_id
      and contact.tenant_id = v_tenant_id;

    -- An anonymous form may link a known established identity to the raw event,
    -- but must not rewrite it. Blank-field enrichment is limited to identity-free
    -- contacts created by approved interest-intake or historical migration lanes.
    if v_nominator_profile_id is null
       and v_nominator_source = any (array[
         'valorwell_website_bty_nomination',
         'valorwell_website_interest',
         'therapist_crm_interest_migration'
       ]::text[]) then
      update public.relationship_contacts as contact
      set first_name = case
            when nullif(pg_catalog.btrim(contact.first_name), '') is null
            then pg_catalog.btrim(p_payload ->> 'first_name')
            else contact.first_name
          end,
          last_name = case
            when nullif(pg_catalog.btrim(contact.last_name), '') is null
            then pg_catalog.btrim(p_payload ->> 'last_name')
            else contact.last_name
          end,
          phone = case
            when nullif(pg_catalog.btrim(contact.phone), '') is null
            then nullif(pg_catalog.btrim(p_payload ->> 'phone'), '')
            else contact.phone
          end,
          metadata = coalesce(contact.metadata, '{}'::jsonb)
            || pg_catalog.jsonb_build_object('latest_bty_nomination_at', v_now),
          updated_at = v_now
      where contact.id = v_nominator_id
        and contact.tenant_id = v_tenant_id;
    end if;
  end if;

  v_subject_source_key := case
    when v_subject_link is not null then
      'subject:' || v_nomination_type || ':link:'
        || pg_catalog.md5(pg_catalog.lower(v_subject_link))
    else
      'subject:' || v_nomination_type || ':request:' || v_submission_key
  end;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('bty-nomination-subject:' || v_subject_source_key, 0)
  );

  if v_nomination_type = 'individual' then
    select contact.id
    into v_subject_contact_id
    from public.relationship_contacts as contact
    where contact.tenant_id = v_tenant_id
      and contact.source = 'valorwell_website_bty_nomination'
      and contact.source_record_key = v_subject_source_key
    limit 1;

    if v_subject_contact_id is null then
      insert into public.relationship_contacts (
        tenant_id,
        profile_id,
        first_name,
        preferred_name,
        veteran_affiliation,
        outreach_status,
        review_state,
        source,
        source_record_key,
        metadata
      ) values (
        v_tenant_id,
        null,
        v_subject_name,
        v_subject_name,
        case when v_subject_veteran_affiliated then 'military_connected' else 'unknown' end,
        'new',
        'review_needed',
        'valorwell_website_bty_nomination',
        v_subject_source_key,
        pg_catalog.jsonb_build_object(
          'subject_link', v_subject_link,
          'first_bty_nomination_at', v_now,
          'latest_bty_nomination_at', v_now
        )
      )
      returning id into v_subject_contact_id;
    else
      update public.relationship_contacts as contact
      set veteran_affiliation = case
            when v_subject_veteran_affiliated
              and contact.veteran_affiliation = 'unknown'
            then 'military_connected'
            else contact.veteran_affiliation
          end,
          metadata = coalesce(contact.metadata, '{}'::jsonb)
            || pg_catalog.jsonb_build_object(
              'subject_link', v_subject_link,
              'latest_bty_nomination_at', v_now
            ),
          updated_at = v_now
      where contact.id = v_subject_contact_id
        and contact.tenant_id = v_tenant_id;
    end if;

    insert into public.relationship_contact_roles (
      tenant_id,
      contact_id,
      role_code,
      source,
      metadata
    ) values (
      v_tenant_id,
      v_subject_contact_id,
      'bty_nominee',
      'valorwell_website_bty_nomination',
      pg_catalog.jsonb_build_object('latest_bty_nomination_at', v_now)
    )
    on conflict (contact_id, role_code) do nothing;
  else
    select organization.id
    into v_subject_organization_id
    from public.relationship_organizations as organization
    where organization.tenant_id = v_tenant_id
      and organization.source = 'valorwell_website_bty_nomination'
      and organization.source_record_key = v_subject_source_key
    limit 1;

    if v_subject_organization_id is null then
      insert into public.relationship_organizations (
        tenant_id,
        name,
        veteran_affiliated,
        website,
        outreach_status,
        source,
        source_record_key,
        metadata
      ) values (
        v_tenant_id,
        v_subject_name,
        case when v_subject_veteran_affiliated then true else null end,
        v_subject_link,
        'new',
        'valorwell_website_bty_nomination',
        v_subject_source_key,
        pg_catalog.jsonb_build_object(
          'first_bty_nomination_at', v_now,
          'latest_bty_nomination_at', v_now
        )
      )
      returning id into v_subject_organization_id;
    else
      update public.relationship_organizations as organization
      set veteran_affiliated = case
            when v_subject_veteran_affiliated
              and organization.veteran_affiliated is null
            then true
            else organization.veteran_affiliated
          end,
          website = coalesce(
            nullif(pg_catalog.btrim(organization.website), ''),
            v_subject_link
          ),
          metadata = coalesce(organization.metadata, '{}'::jsonb)
            || pg_catalog.jsonb_build_object('latest_bty_nomination_at', v_now),
          updated_at = v_now
      where organization.id = v_subject_organization_id
        and organization.tenant_id = v_tenant_id;
    end if;

    insert into public.relationship_organization_roles (
      tenant_id,
      organization_id,
      role_code,
      source,
      metadata
    ) values (
      v_tenant_id,
      v_subject_organization_id,
      'bty_nominee',
      'valorwell_website_bty_nomination',
      pg_catalog.jsonb_build_object('latest_bty_nomination_at', v_now)
    )
    on conflict (organization_id, role_code) do nothing;
  end if;

  insert into public.website_submissions (
    tenant_id,
    submission_type,
    original_lane,
    normalized_lane,
    contact_id,
    subject_contact_id,
    subject_organization_id,
    source_system,
    source_record_key,
    payload,
    consent,
    source_page,
    user_agent,
    status,
    submitted_at
  ) values (
    v_tenant_id,
    'bty_submission',
    'nominate',
    'bty_participation',
    v_nominator_id,
    v_subject_contact_id,
    v_subject_organization_id,
    'valorwell_website_bty_nomination',
    v_submission_source_key,
    p_payload,
    true,
    coalesce(nullif(pg_catalog.btrim(p_payload ->> 'source_page'), ''), '/beyondtheyellow'),
    nullif(pg_catalog.btrim(p_payload ->> 'user_agent'), ''),
    'new',
    v_now
  );

  return pg_catalog.jsonb_build_object('ok', true);
exception
  when sqlstate '22023' then
    raise exception using errcode = '22023', message = 'Invalid nomination.';
  when others then
    raise exception using
      errcode = 'P0001',
      message = 'Unable to submit nomination right now.';
end
$function$;

comment on function public.submit_website_bty_nomination(jsonb) is
  'Anonymous validation-first Beyond The Yellow nomination intake. Does not create or link Auth users.';

revoke all on table public.relationship_contacts from anon;
revoke all on table public.relationship_organizations from anon;
revoke all on table public.relationship_contact_roles from anon;
revoke all on table public.relationship_organization_roles from anon;
revoke all on table public.website_submissions from anon;

revoke all on function public.submit_website_bty_nomination(jsonb) from public;
revoke all on function public.submit_website_bty_nomination(jsonb) from anon;
revoke all on function public.submit_website_bty_nomination(jsonb) from authenticated;
revoke all on function public.submit_website_bty_nomination(jsonb) from service_role;
grant execute on function public.submit_website_bty_nomination(jsonb) to anon, authenticated;
