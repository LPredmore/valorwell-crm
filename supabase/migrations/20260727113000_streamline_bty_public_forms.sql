-- Purpose-built Beyond The Yellow public intake contracts.
-- These functions are additive so cached clients may continue using the earlier RPCs.

create index if not exists website_submissions_bty_guest_application_rate_idx
  on public.website_submissions (
    tenant_id,
    lower(btrim(payload ->> 'email')),
    submitted_at desc
  )
  where source_system = 'valorwell_website_bty_guest_application'
    and submission_type = 'interest_submission';

create index if not exists website_submissions_bty_contact_nomination_rate_idx
  on public.website_submissions (
    tenant_id,
    lower(btrim(payload ->> 'email')),
    submitted_at desc
  )
  where source_system = 'valorwell_website_bty_contact_nomination'
    and submission_type = 'bty_submission';

create or replace function public.submit_website_bty_guest_application(p_payload jsonb)
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
  v_first_name text;
  v_last_name text;
  v_phone text;
  v_connection text;
  v_contact_affiliation text;
  v_summary text;
  v_work_link text;
  v_source_page text;
  v_user_agent text;
  v_contact_id uuid;
  v_inserted_contact_id uuid;
  v_email_match_count integer;
  v_existing_payload_matches boolean;
  v_now timestamptz := pg_catalog.now();
  v_key text;
begin
  if p_payload is null
     or pg_catalog.jsonb_typeof(p_payload) is distinct from 'object'
     or pg_catalog.octet_length(p_payload::text) > 16384 then
    raise exception using errcode = '22023', message = 'Invalid application.';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(p_payload) as supplied(key)
    where supplied.key <> all (array[
      'submission_key', 'first_name', 'last_name', 'email', 'phone',
      'veteran_connection', 'conversation_summary', 'work_link',
      'recording_ready', 'consent', 'source_page', 'user_agent'
    ]::text[])
  ) then
    raise exception using errcode = '22023', message = 'Invalid application.';
  end if;

  foreach v_key in array array[
    'submission_key', 'first_name', 'last_name', 'email', 'phone',
    'veteran_connection', 'conversation_summary', 'work_link',
    'source_page', 'user_agent'
  ]::text[] loop
    if p_payload ? v_key
       and p_payload -> v_key <> 'null'::jsonb
       and pg_catalog.jsonb_typeof(p_payload -> v_key) <> 'string' then
      raise exception using errcode = '22023', message = 'Invalid application.';
    end if;
  end loop;

  foreach v_key in array array['recording_ready', 'consent']::text[] loop
    if p_payload -> v_key is null
       or p_payload -> v_key = 'null'::jsonb
       or pg_catalog.jsonb_typeof(p_payload -> v_key) <> 'boolean' then
      raise exception using errcode = '22023', message = 'Invalid application.';
    end if;
  end loop;

  v_submission_key := pg_catalog.btrim(p_payload ->> 'submission_key');
  v_first_name := pg_catalog.btrim(p_payload ->> 'first_name');
  v_last_name := pg_catalog.btrim(p_payload ->> 'last_name');
  v_email := pg_catalog.lower(pg_catalog.btrim(p_payload ->> 'email'));
  v_phone := nullif(pg_catalog.btrim(p_payload ->> 'phone'), '');
  v_connection := pg_catalog.btrim(p_payload ->> 'veteran_connection');
  v_summary := pg_catalog.btrim(p_payload ->> 'conversation_summary');
  v_work_link := nullif(pg_catalog.btrim(p_payload ->> 'work_link'), '');
  v_source_page := coalesce(nullif(pg_catalog.btrim(p_payload ->> 'source_page'), ''), '/beyondtheyellow');
  v_user_agent := nullif(pg_catalog.btrim(p_payload ->> 'user_agent'), '');

  if v_submission_key is null
     or pg_catalog.length(v_submission_key) not between 8 and 128
     or v_submission_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
     or nullif(v_first_name, '') is null
     or pg_catalog.length(v_first_name) > 100
     or nullif(v_last_name, '') is null
     or pg_catalog.length(v_last_name) > 100
     or v_email is null
     or pg_catalog.length(v_email) > 254
     or v_email !~ $email$^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$$email$
     or pg_catalog.length(coalesce(v_phone, '')) > 40
     or v_connection <> all (array[
       'veteran', 'family_member', 'military_connected',
       'serves_veterans', 'none', 'prefer_not_to_say'
     ]::text[])
     or nullif(v_summary, '') is null
     or pg_catalog.length(v_summary) not between 10 and 3000
     or pg_catalog.length(coalesce(v_work_link, '')) > 500
     or (v_work_link is not null and v_work_link !~* '^https://[^[:space:]]+$')
     or pg_catalog.length(v_source_page) > 200
     or pg_catalog.length(coalesce(v_user_agent, '')) > 500
     or not (p_payload ->> 'recording_ready')::boolean
     or not (p_payload ->> 'consent')::boolean then
    raise exception using errcode = '22023', message = 'Invalid application.';
  end if;

  v_contact_affiliation := case v_connection
    when 'veteran' then 'veteran'
    when 'family_member' then 'family_member'
    when 'military_connected' then 'military_connected'
    when 'none' then 'none'
    else 'unknown'
  end;

  v_tenant_id := public.website_intake_tenant_id();
  if v_tenant_id is null then
    raise exception using errcode = 'P0001', message = 'Unable to submit application right now.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('bty-guest-application-request:' || v_submission_key, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('bty-guest-application-email:' || v_email, 0)
  );

  v_submission_source_key := 'request:' || v_submission_key;
  select
    submission.payload = p_payload
      and pg_catalog.lower(pg_catalog.btrim(submission.payload ->> 'email')) = v_email
  into v_existing_payload_matches
  from public.website_submissions as submission
  where submission.tenant_id = v_tenant_id
    and submission.source_system = 'valorwell_website_bty_guest_application'
    and submission.source_record_key = v_submission_source_key;

  if found then
    if not coalesce(v_existing_payload_matches, false) then
      raise exception using errcode = 'P0001', message = 'Unable to submit application right now.';
    end if;
    return pg_catalog.jsonb_build_object('ok', true);
  end if;

  if (
    select pg_catalog.count(distinct submission.source_record_key)
    from public.website_submissions as submission
    where submission.tenant_id = v_tenant_id
      and submission.source_system = 'valorwell_website_bty_guest_application'
      and submission.submission_type = 'interest_submission'
      and submission.submitted_at >= v_now - interval '1 hour'
      and pg_catalog.lower(pg_catalog.btrim(submission.payload ->> 'email')) = v_email
  ) >= 5 then
    raise exception using errcode = 'P0001', message = 'Unable to submit application right now.';
  end if;

  select
    pg_catalog.count(*),
    (pg_catalog.array_agg(contact.id order by contact.id))[1]
  into v_email_match_count, v_contact_id
  from public.relationship_contacts as contact
  where contact.tenant_id = v_tenant_id
    and pg_catalog.lower(pg_catalog.btrim(contact.email)) = v_email;

  if v_email_match_count > 1 then
    insert into public.website_submissions (
      tenant_id, submission_type, original_lane, normalized_lane,
      source_system, source_record_key, payload, consent, source_page,
      user_agent, status, submitted_at
    ) values (
      v_tenant_id, 'interest_submission', 'bty_guest_application', 'bty_participation',
      'valorwell_website_bty_guest_application', v_submission_source_key, p_payload,
      true, v_source_page, v_user_agent, 'reviewing', v_now
    );
    return pg_catalog.jsonb_build_object('ok', true, 'needs_review', true);
  end if;

  if v_contact_id is null then
    insert into public.relationship_contacts (
      tenant_id, profile_id, first_name, last_name, email, phone,
      veteran_affiliation, outreach_status, review_state, source,
      source_record_key, metadata
    ) values (
      v_tenant_id, null, v_first_name, v_last_name, v_email, v_phone,
      v_contact_affiliation, 'new', 'review_needed',
      'valorwell_website_bty_guest_application',
      'email:' || pg_catalog.md5(v_email),
      pg_catalog.jsonb_build_object(
        'first_bty_guest_application_at', v_now,
        'latest_bty_guest_application_at', v_now,
        'veteran_connection_response', v_connection
      )
    )
    on conflict do nothing
    returning id into v_inserted_contact_id;

    v_contact_id := v_inserted_contact_id;
    if v_contact_id is null then
      select contact.id
      into v_contact_id
      from public.relationship_contacts as contact
      where contact.tenant_id = v_tenant_id
        and pg_catalog.lower(pg_catalog.btrim(contact.email)) = v_email
      limit 1;
    end if;
  end if;

  if v_contact_id is null then
    raise exception using errcode = 'P0001', message = 'Unable to submit application right now.';
  end if;

  update public.relationship_contacts as contact
  set first_name = case when nullif(pg_catalog.btrim(contact.first_name), '') is null then v_first_name else contact.first_name end,
      last_name = case when nullif(pg_catalog.btrim(contact.last_name), '') is null then v_last_name else contact.last_name end,
      phone = case when nullif(pg_catalog.btrim(contact.phone), '') is null then v_phone else contact.phone end,
      veteran_affiliation = case
        when contact.veteran_affiliation = 'unknown' and v_contact_affiliation <> 'unknown'
        then v_contact_affiliation
        else contact.veteran_affiliation
      end,
      review_state = coalesce(contact.review_state, 'review_needed'),
      metadata = coalesce(contact.metadata, '{}'::jsonb) || pg_catalog.jsonb_build_object(
        'latest_bty_guest_application_at', v_now,
        'veteran_connection_response', v_connection
      ),
      updated_at = v_now
  where contact.id = v_contact_id
    and contact.tenant_id = v_tenant_id;

  insert into public.relationship_influencer_profiles (
    contact_id, tenant_id, status, motivation, willing_to_share,
    comfort_level, accepted_rules, additional_info, profile_complete,
    source, source_record_key, metadata
  ) values (
    v_contact_id, v_tenant_id, 'new', v_summary, true,
    'public_story', true, v_work_link, false,
    'valorwell_website_bty_guest_application',
    'contact:' || v_contact_id::text,
    pg_catalog.jsonb_build_object(
      'recording_ready', true,
      'work_link', v_work_link,
      'latest_bty_guest_application_at', v_now
    )
  )
  on conflict (contact_id) do update
  set status = case
        when public.relationship_influencer_profiles.status in ('closed', 'invalid_spam')
        then public.relationship_influencer_profiles.status
        else 'new'
      end,
      motivation = excluded.motivation,
      willing_to_share = true,
      comfort_level = 'public_story',
      accepted_rules = true,
      additional_info = coalesce(excluded.additional_info, public.relationship_influencer_profiles.additional_info),
      source = excluded.source,
      source_record_key = excluded.source_record_key,
      metadata = coalesce(public.relationship_influencer_profiles.metadata, '{}'::jsonb) || excluded.metadata,
      updated_at = v_now;

  insert into public.relationship_contact_roles (
    tenant_id, contact_id, role_code, source, metadata
  ) values (
    v_tenant_id, v_contact_id, 'bty_promoter',
    'valorwell_website_bty_guest_application',
    pg_catalog.jsonb_build_object('latest_bty_guest_application_at', v_now)
  )
  on conflict (contact_id, role_code) do update
  set source = excluded.source,
      metadata = coalesce(public.relationship_contact_roles.metadata, '{}'::jsonb) || excluded.metadata,
      updated_at = v_now;

  if v_work_link is not null then
    insert into public.relationship_social_profiles (
      tenant_id, contact_id, organization_id, platform_name,
      profile_url, approved, source, source_record_key, metadata
    ) values (
      v_tenant_id, v_contact_id, null, 'website',
      v_work_link, null, 'valorwell_website_bty_guest_application',
      'contact:' || v_contact_id::text || ':work-link:' || pg_catalog.md5(pg_catalog.lower(v_work_link)),
      pg_catalog.jsonb_build_object('submitted_as', 'work_link')
    )
    on conflict do nothing;
  end if;

  insert into public.website_submissions (
    tenant_id, submission_type, original_lane, normalized_lane,
    contact_id, source_system, source_record_key, payload, consent,
    source_page, user_agent, status, submitted_at
  ) values (
    v_tenant_id, 'interest_submission', 'bty_guest_application', 'bty_participation',
    v_contact_id, 'valorwell_website_bty_guest_application',
    v_submission_source_key, p_payload, true, v_source_page,
    v_user_agent, 'new', v_now
  );

  return pg_catalog.jsonb_build_object('ok', true);
end
$function$;

alter function public.submit_website_bty_guest_application(jsonb) owner to postgres;
revoke all on function public.submit_website_bty_guest_application(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.submit_website_bty_guest_application(jsonb) to anon, authenticated, service_role;

comment on function public.submit_website_bty_guest_application(jsonb) is
  'Minimal public BTY podcast guest application. Creates no Auth, staff, provider, or clinical client account.';

create or replace function public.submit_website_bty_contact_nomination(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tenant_id uuid;
  v_submission_key text;
  v_submission_source_key text;
  v_nomination_type text;
  v_organization_name text;
  v_first_name text;
  v_last_name text;
  v_email text;
  v_phone text;
  v_role_title text;
  v_subject_link text;
  v_veteran_connection text;
  v_reason text;
  v_source_page text;
  v_user_agent text;
  v_contact_id uuid;
  v_inserted_contact_id uuid;
  v_email_match_count integer;
  v_contact_affiliation text;
  v_organization_id uuid;
  v_inserted_organization_id uuid;
  v_organization_source_key text;
  v_existing_payload_matches boolean;
  v_now timestamptz := pg_catalog.now();
  v_key text;
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
      'submission_key', 'nomination_type', 'organization_name',
      'first_name', 'last_name', 'email', 'phone', 'role_title',
      'subject_link', 'veteran_connection', 'reason', 'consent',
      'source_page', 'user_agent'
    ]::text[])
  ) then
    raise exception using errcode = '22023', message = 'Invalid nomination.';
  end if;

  foreach v_key in array array[
    'submission_key', 'nomination_type', 'organization_name',
    'first_name', 'last_name', 'email', 'phone', 'role_title',
    'subject_link', 'veteran_connection', 'reason', 'source_page', 'user_agent'
  ]::text[] loop
    if p_payload ? v_key
       and p_payload -> v_key <> 'null'::jsonb
       and pg_catalog.jsonb_typeof(p_payload -> v_key) <> 'string' then
      raise exception using errcode = '22023', message = 'Invalid nomination.';
    end if;
  end loop;

  if p_payload -> 'consent' is null
     or p_payload -> 'consent' = 'null'::jsonb
     or pg_catalog.jsonb_typeof(p_payload -> 'consent') <> 'boolean' then
    raise exception using errcode = '22023', message = 'Invalid nomination.';
  end if;

  v_submission_key := pg_catalog.btrim(p_payload ->> 'submission_key');
  v_nomination_type := pg_catalog.btrim(p_payload ->> 'nomination_type');
  v_organization_name := nullif(pg_catalog.btrim(p_payload ->> 'organization_name'), '');
  v_first_name := pg_catalog.btrim(p_payload ->> 'first_name');
  v_last_name := pg_catalog.btrim(p_payload ->> 'last_name');
  v_email := pg_catalog.lower(pg_catalog.btrim(p_payload ->> 'email'));
  v_phone := nullif(pg_catalog.btrim(p_payload ->> 'phone'), '');
  v_role_title := nullif(pg_catalog.btrim(p_payload ->> 'role_title'), '');
  v_subject_link := nullif(pg_catalog.btrim(p_payload ->> 'subject_link'), '');
  v_veteran_connection := pg_catalog.btrim(p_payload ->> 'veteran_connection');
  v_reason := pg_catalog.btrim(p_payload ->> 'reason');
  v_source_page := coalesce(nullif(pg_catalog.btrim(p_payload ->> 'source_page'), ''), '/beyondtheyellow');
  v_user_agent := nullif(pg_catalog.btrim(p_payload ->> 'user_agent'), '');

  if v_submission_key is null
     or pg_catalog.length(v_submission_key) not between 8 and 128
     or v_submission_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
     or v_nomination_type <> all (array['individual', 'organization']::text[])
     or (v_nomination_type = 'organization' and v_organization_name is null)
     or pg_catalog.length(coalesce(v_organization_name, '')) > 200
     or nullif(v_first_name, '') is null
     or pg_catalog.length(v_first_name) > 100
     or nullif(v_last_name, '') is null
     or pg_catalog.length(v_last_name) > 100
     or v_email is null
     or pg_catalog.length(v_email) > 254
     or v_email !~ $email$^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$$email$
     or pg_catalog.length(coalesce(v_phone, '')) > 50
     or pg_catalog.length(coalesce(v_role_title, '')) > 150
     or pg_catalog.length(coalesce(v_subject_link, '')) > 500
     or (v_subject_link is not null and v_subject_link !~* '^https://[^[:space:]]+$')
     or v_veteran_connection <> all (array['yes', 'no', 'unknown']::text[])
     or nullif(v_reason, '') is null
     or pg_catalog.length(v_reason) not between 10 and 3000
     or pg_catalog.length(v_source_page) > 200
     or pg_catalog.length(coalesce(v_user_agent, '')) > 500
     or not (p_payload ->> 'consent')::boolean then
    raise exception using errcode = '22023', message = 'Invalid nomination.';
  end if;

  v_contact_affiliation := case
    when v_nomination_type = 'individual' and v_veteran_connection = 'yes' then 'military_connected'
    when v_nomination_type = 'individual' and v_veteran_connection = 'no' then 'none'
    else 'unknown'
  end;

  v_tenant_id := public.website_intake_tenant_id();
  if v_tenant_id is null then
    raise exception using errcode = 'P0001', message = 'Unable to submit nomination right now.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('bty-contact-nomination-request:' || v_submission_key, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('bty-contact-nomination-email:' || v_email, 0)
  );

  v_submission_source_key := 'request:' || v_submission_key;
  select
    submission.payload = p_payload
      and pg_catalog.lower(pg_catalog.btrim(submission.payload ->> 'email')) = v_email
  into v_existing_payload_matches
  from public.website_submissions as submission
  where submission.tenant_id = v_tenant_id
    and submission.source_system = 'valorwell_website_bty_contact_nomination'
    and submission.source_record_key = v_submission_source_key;

  if found then
    if not coalesce(v_existing_payload_matches, false) then
      raise exception using errcode = 'P0001', message = 'Unable to submit nomination right now.';
    end if;
    return pg_catalog.jsonb_build_object('ok', true);
  end if;

  if (
    select pg_catalog.count(distinct submission.source_record_key)
    from public.website_submissions as submission
    where submission.tenant_id = v_tenant_id
      and submission.source_system = 'valorwell_website_bty_contact_nomination'
      and submission.submission_type = 'bty_submission'
      and submission.submitted_at >= v_now - interval '1 hour'
      and pg_catalog.lower(pg_catalog.btrim(submission.payload ->> 'email')) = v_email
  ) >= 5 then
    raise exception using errcode = 'P0001', message = 'Unable to submit nomination right now.';
  end if;

  select
    pg_catalog.count(*),
    (pg_catalog.array_agg(contact.id order by contact.id))[1]
  into v_email_match_count, v_contact_id
  from public.relationship_contacts as contact
  where contact.tenant_id = v_tenant_id
    and pg_catalog.lower(pg_catalog.btrim(contact.email)) = v_email;

  if v_email_match_count > 1 then
    insert into public.website_submissions (
      tenant_id, submission_type, original_lane, normalized_lane,
      source_system, source_record_key, payload, consent, source_page,
      user_agent, status, submitted_at
    ) values (
      v_tenant_id, 'bty_submission', 'nominate', 'bty_participation',
      'valorwell_website_bty_contact_nomination', v_submission_source_key,
      p_payload, true, v_source_page, v_user_agent, 'reviewing', v_now
    );
    return pg_catalog.jsonb_build_object('ok', true, 'needs_review', true);
  end if;

  if v_contact_id is null then
    insert into public.relationship_contacts (
      tenant_id, profile_id, first_name, last_name, email, phone,
      veteran_affiliation, outreach_status, review_state, source,
      source_record_key, metadata
    ) values (
      v_tenant_id, null, v_first_name, v_last_name, v_email, v_phone,
      v_contact_affiliation, 'new', 'review_needed',
      'valorwell_website_bty_contact_nomination',
      'email:' || pg_catalog.md5(v_email),
      pg_catalog.jsonb_build_object(
        'first_bty_contact_nomination_at', v_now,
        'latest_bty_contact_nomination_at', v_now,
        'nomination_contact_type', v_nomination_type
      )
    )
    on conflict do nothing
    returning id into v_inserted_contact_id;

    v_contact_id := v_inserted_contact_id;
    if v_contact_id is null then
      select contact.id
      into v_contact_id
      from public.relationship_contacts as contact
      where contact.tenant_id = v_tenant_id
        and pg_catalog.lower(pg_catalog.btrim(contact.email)) = v_email
      limit 1;
    end if;
  end if;

  if v_contact_id is null then
    raise exception using errcode = 'P0001', message = 'Unable to submit nomination right now.';
  end if;

  update public.relationship_contacts as contact
  set first_name = case when nullif(pg_catalog.btrim(contact.first_name), '') is null then v_first_name else contact.first_name end,
      last_name = case when nullif(pg_catalog.btrim(contact.last_name), '') is null then v_last_name else contact.last_name end,
      phone = case when nullif(pg_catalog.btrim(contact.phone), '') is null then v_phone else contact.phone end,
      veteran_affiliation = case
        when contact.veteran_affiliation = 'unknown' and v_contact_affiliation <> 'unknown'
        then v_contact_affiliation
        else contact.veteran_affiliation
      end,
      review_state = coalesce(contact.review_state, 'review_needed'),
      metadata = coalesce(contact.metadata, '{}'::jsonb) || pg_catalog.jsonb_build_object(
        'latest_bty_contact_nomination_at', v_now,
        'nomination_contact_type', v_nomination_type
      ),
      updated_at = v_now
  where contact.id = v_contact_id
    and contact.tenant_id = v_tenant_id;

  if v_nomination_type = 'individual' then
    insert into public.relationship_contact_roles (
      tenant_id, contact_id, role_code, source, metadata
    ) values (
      v_tenant_id, v_contact_id, 'bty_nominee',
      'valorwell_website_bty_contact_nomination',
      pg_catalog.jsonb_build_object('latest_bty_nomination_at', v_now)
    )
    on conflict (contact_id, role_code) do update
    set source = excluded.source,
        metadata = coalesce(public.relationship_contact_roles.metadata, '{}'::jsonb) || excluded.metadata,
        updated_at = v_now;

    if v_subject_link is not null then
      insert into public.relationship_social_profiles (
        tenant_id, contact_id, organization_id, platform_name,
        profile_url, approved, source, source_record_key, metadata
      ) values (
        v_tenant_id, v_contact_id, null, 'website',
        v_subject_link, null, 'valorwell_website_bty_contact_nomination',
        'contact:' || v_contact_id::text || ':nomination-link:' || pg_catalog.md5(pg_catalog.lower(v_subject_link)),
        pg_catalog.jsonb_build_object('submitted_as', 'nomination_link')
      )
      on conflict do nothing;
    end if;
  else
    v_organization_source_key := case
      when v_subject_link is not null then
        'organization:link:' || pg_catalog.md5(pg_catalog.lower(v_subject_link))
      else
        'organization:name:' || pg_catalog.md5(pg_catalog.lower(v_organization_name))
    end;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('bty-contact-nomination-organization:' || v_organization_source_key, 0)
    );

    select organization.id
    into v_organization_id
    from public.relationship_organizations as organization
    where organization.tenant_id = v_tenant_id
      and organization.source = 'valorwell_website_bty_contact_nomination'
      and organization.source_record_key = v_organization_source_key
    limit 1;

    if v_organization_id is null then
      insert into public.relationship_organizations (
        tenant_id, name, website, organization_kind, veteran_affiliated,
        outreach_status, source, source_record_key, metadata
      ) values (
        v_tenant_id, v_organization_name, v_subject_link, null,
        case v_veteran_connection when 'yes' then true when 'no' then false else null end,
        'new', 'valorwell_website_bty_contact_nomination',
        v_organization_source_key,
        pg_catalog.jsonb_build_object(
          'first_bty_nomination_at', v_now,
          'latest_bty_nomination_at', v_now
        )
      )
      on conflict do nothing
      returning id into v_inserted_organization_id;

      v_organization_id := v_inserted_organization_id;
      if v_organization_id is null then
        select organization.id
        into v_organization_id
        from public.relationship_organizations as organization
        where organization.tenant_id = v_tenant_id
          and organization.source = 'valorwell_website_bty_contact_nomination'
          and organization.source_record_key = v_organization_source_key
        limit 1;
      end if;
    end if;

    if v_organization_id is null then
      raise exception using errcode = 'P0001', message = 'Unable to submit nomination right now.';
    end if;

    update public.relationship_organizations as organization
    set website = case when nullif(pg_catalog.btrim(organization.website), '') is null then v_subject_link else organization.website end,
        veteran_affiliated = coalesce(
          organization.veteran_affiliated,
          case v_veteran_connection when 'yes' then true when 'no' then false else null end
        ),
        metadata = coalesce(organization.metadata, '{}'::jsonb) || pg_catalog.jsonb_build_object(
          'latest_bty_nomination_at', v_now
        ),
        updated_at = v_now
    where organization.id = v_organization_id
      and organization.tenant_id = v_tenant_id;

    insert into public.relationship_organization_roles (
      tenant_id, organization_id, role_code, source, metadata
    ) values (
      v_tenant_id, v_organization_id, 'bty_nominee',
      'valorwell_website_bty_contact_nomination',
      pg_catalog.jsonb_build_object('latest_bty_nomination_at', v_now)
    )
    on conflict (organization_id, role_code) do update
    set source = excluded.source,
        metadata = coalesce(public.relationship_organization_roles.metadata, '{}'::jsonb) || excluded.metadata,
        updated_at = v_now;

    insert into public.relationship_contact_organizations (
      tenant_id, contact_id, organization_id, role_title, is_primary, metadata
    ) values (
      v_tenant_id, v_contact_id, v_organization_id, v_role_title, true,
      pg_catalog.jsonb_build_object('source', 'bty_contact_nomination')
    )
    on conflict (contact_id, organization_id) do update
    set role_title = coalesce(excluded.role_title, public.relationship_contact_organizations.role_title),
        is_primary = true,
        metadata = coalesce(public.relationship_contact_organizations.metadata, '{}'::jsonb) || excluded.metadata,
        updated_at = v_now;

    if v_subject_link is not null then
      insert into public.relationship_social_profiles (
        tenant_id, contact_id, organization_id, platform_name,
        profile_url, approved, source, source_record_key, metadata
      ) values (
        v_tenant_id, null, v_organization_id, 'website',
        v_subject_link, null, 'valorwell_website_bty_contact_nomination',
        'organization:' || v_organization_id::text || ':nomination-link:' || pg_catalog.md5(pg_catalog.lower(v_subject_link)),
        pg_catalog.jsonb_build_object('submitted_as', 'nomination_link')
      )
      on conflict do nothing;
    end if;
  end if;

  insert into public.website_submissions (
    tenant_id, submission_type, original_lane, normalized_lane,
    contact_id, organization_id, subject_contact_id, subject_organization_id,
    source_system, source_record_key, payload, consent, source_page,
    user_agent, status, submitted_at
  ) values (
    v_tenant_id, 'bty_submission', 'nominate', 'bty_participation',
    v_contact_id,
    case when v_nomination_type = 'organization' then v_organization_id else null end,
    case when v_nomination_type = 'individual' then v_contact_id else null end,
    case when v_nomination_type = 'organization' then v_organization_id else null end,
    'valorwell_website_bty_contact_nomination', v_submission_source_key,
    p_payload, true, v_source_page, v_user_agent, 'new', v_now
  );

  return pg_catalog.jsonb_build_object('ok', true);
end
$function$;

alter function public.submit_website_bty_contact_nomination(jsonb) owner to postgres;
revoke all on function public.submit_website_bty_contact_nomination(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.submit_website_bty_contact_nomination(jsonb) to anon, authenticated, service_role;

comment on function public.submit_website_bty_contact_nomination(jsonb) is
  'Public BTY nomination using the nominee or organization contact information. Creates no Auth, staff, provider, or clinical client account.';

notify pgrst, 'reload schema';
