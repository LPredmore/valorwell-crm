-- Creator, promoter, storyteller, supporter, connector, and community-interest
-- intake for the ValorWell website. This migration is intentionally additive.

alter table public.relationship_contacts
  add column if not exists review_state text;

alter table public.relationship_contacts
  alter column review_state drop default,
  alter column review_state drop not null;

do $migration$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.relationship_contacts'::pg_catalog.regclass
      and conname = 'relationship_contacts_review_state_check'
  ) then
    alter table public.relationship_contacts
      add constraint relationship_contacts_review_state_check
      check (
        review_state = any (array[
          'review_needed'::text,
          'direct_outreach'::text,
          'nurture'::text,
          'not_relevant'::text,
          'duplicate'::text,
          'invalid_spam'::text,
          'managed'::text
        ])
      );
  end if;
end
$migration$;

update public.relationship_contacts
set review_state = 'review_needed'
where source = 'therapist_crm_interest_migration'
  and review_state is null;

comment on column public.relationship_contacts.review_state is
  'Optional inbound-interest triage state, separate from outreach_status. Null means this contact is outside the interest-review queue.';

alter table public.crm_notes
  add column if not exists relationship_contact_id uuid;

do $migration$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.relationship_contacts'::pg_catalog.regclass
      and conname = 'relationship_contacts_tenant_id_id_key'
  ) then
    alter table public.relationship_contacts
      add constraint relationship_contacts_tenant_id_id_key
      unique (tenant_id, id);
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.crm_notes'::pg_catalog.regclass
      and conname = 'crm_notes_relationship_contact_id_fkey'
  ) then
    alter table public.crm_notes
      add constraint crm_notes_relationship_contact_id_fkey
      foreign key (tenant_id, relationship_contact_id)
      references public.relationship_contacts (tenant_id, id)
      on delete restrict;
  end if;
end
$migration$;

comment on column public.crm_notes.relationship_contact_id is
  'Optional canonical relationship contact associated with this interaction note.';

create index if not exists relationship_contacts_review_queue_idx
  on public.relationship_contacts
    (tenant_id, review_state, next_action_due_at, updated_at desc);

create index if not exists relationship_contacts_interest_source_idx
  on public.relationship_contacts (tenant_id, source, created_at desc);

create index if not exists relationship_contact_roles_queue_idx
  on public.relationship_contact_roles (tenant_id, role_code, contact_id);

create index if not exists relationship_social_profiles_queue_idx
  on public.relationship_social_profiles
    (tenant_id, lower(platform_name), follower_count desc nulls last, contact_id)
  where contact_id is not null;

create index if not exists crm_notes_relationship_contact_covering_idx
  on public.crm_notes (tenant_id, relationship_contact_id, created_at desc)
  include (created_by_profile_id, note_type)
  where relationship_contact_id is not null;

create index if not exists website_submissions_interest_conflict_queue_idx
  on public.website_submissions (tenant_id, submitted_at desc)
  where source_system = 'valorwell_website_interest'
    and submission_type = 'interest_submission'
    and status = 'reviewing'
    and contact_id is null;

create index if not exists website_submissions_creator_interest_rate_limit_idx
  on public.website_submissions (
    tenant_id,
    lower(btrim(payload ->> 'email')),
    submitted_at desc
  )
  where source_system = 'valorwell_website_interest'
    and submission_type = 'interest_submission';

-- Staff-facing exception feed for submissions that could not be attached to one
-- canonical contact without guessing. security_invoker keeps website_submissions
-- RLS authoritative for every row returned by the view.
create or replace view public.relationship_interest_submission_conflicts
with (security_invoker = true)
as
select
  submission.id,
  submission.tenant_id,
  submission.source_record_key,
  submission.payload,
  submission.status,
  submission.source_page,
  submission.submitted_at,
  submission.updated_at
from public.website_submissions as submission
where submission.source_system = 'valorwell_website_interest'
  and submission.submission_type = 'interest_submission'
  and submission.status = 'reviewing'
  and submission.contact_id is null;

comment on view public.relationship_interest_submission_conflicts is
  'Tenant-scoped staff queue for creator-interest submissions that require manual contact reconciliation.';

-- Replace the role-only staff policies with tenant-aware authorization. Existing
-- self-service policies remain unchanged.
alter table public.relationship_contacts enable row level security;
alter table public.relationship_influencer_profiles enable row level security;
alter table public.relationship_contact_roles enable row level security;
alter table public.relationship_social_profiles enable row level security;
alter table public.website_submissions enable row level security;

drop policy if exists relationship_contacts_staff_admin
  on public.relationship_contacts;
create policy relationship_contacts_staff_admin
  on public.relationship_contacts
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

drop policy if exists relationship_contacts_owner_insert_guard
  on public.relationship_contacts;
create policy relationship_contacts_owner_insert_guard
  on public.relationship_contacts
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

drop policy if exists relationship_contacts_owner_update_guard
  on public.relationship_contacts;
create policy relationship_contacts_owner_update_guard
  on public.relationship_contacts
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

drop policy if exists relationship_influencer_profiles_staff_admin
  on public.relationship_influencer_profiles;
create policy relationship_influencer_profiles_staff_admin
  on public.relationship_influencer_profiles
  for all
  to authenticated
  using (
    public.is_staff_or_admin((select auth.uid()))
    and public.is_tenant_member((select auth.uid()), tenant_id)
    and exists (
      select 1
      from public.relationship_contacts as contact
      where contact.id = relationship_influencer_profiles.contact_id
        and contact.tenant_id = relationship_influencer_profiles.tenant_id
    )
  )
  with check (
    public.is_staff_or_admin((select auth.uid()))
    and public.is_tenant_member((select auth.uid()), tenant_id)
    and exists (
      select 1
      from public.relationship_contacts as contact
      where contact.id = relationship_influencer_profiles.contact_id
        and contact.tenant_id = relationship_influencer_profiles.tenant_id
    )
  );

drop policy if exists relationship_contact_roles_staff_admin
  on public.relationship_contact_roles;
create policy relationship_contact_roles_staff_admin
  on public.relationship_contact_roles
  for all
  to authenticated
  using (
    public.is_staff_or_admin((select auth.uid()))
    and public.is_tenant_member((select auth.uid()), tenant_id)
    and exists (
      select 1
      from public.relationship_contacts as contact
      where contact.id = relationship_contact_roles.contact_id
        and contact.tenant_id = relationship_contact_roles.tenant_id
    )
  )
  with check (
    public.is_staff_or_admin((select auth.uid()))
    and public.is_tenant_member((select auth.uid()), tenant_id)
    and exists (
      select 1
      from public.relationship_contacts as contact
      where contact.id = relationship_contact_roles.contact_id
        and contact.tenant_id = relationship_contact_roles.tenant_id
    )
  );

drop policy if exists relationship_social_profiles_staff_admin
  on public.relationship_social_profiles;
create policy relationship_social_profiles_staff_admin
  on public.relationship_social_profiles
  for all
  to authenticated
  using (
    public.is_staff_or_admin((select auth.uid()))
    and public.is_tenant_member((select auth.uid()), tenant_id)
    and (
      (
        contact_id is not null
        and exists (
          select 1
          from public.relationship_contacts as contact
          where contact.id = relationship_social_profiles.contact_id
            and contact.tenant_id = relationship_social_profiles.tenant_id
        )
      )
      or (
        organization_id is not null
        and exists (
          select 1
          from public.relationship_organizations as organization
          where organization.id = relationship_social_profiles.organization_id
            and organization.tenant_id = relationship_social_profiles.tenant_id
        )
      )
    )
  )
  with check (
    public.is_staff_or_admin((select auth.uid()))
    and public.is_tenant_member((select auth.uid()), tenant_id)
    and (
      (
        contact_id is not null
        and exists (
          select 1
          from public.relationship_contacts as contact
          where contact.id = relationship_social_profiles.contact_id
            and contact.tenant_id = relationship_social_profiles.tenant_id
        )
      )
      or (
        organization_id is not null
        and exists (
          select 1
          from public.relationship_organizations as organization
          where organization.id = relationship_social_profiles.organization_id
            and organization.tenant_id = relationship_social_profiles.tenant_id
        )
      )
    )
  );

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
  );

-- Keep the legacy tenant-member visibility for client/CRM notes, but relationship
-- prospect interactions are staff-only. This avoids exposing creator-interest
-- notes to client profiles in the same tenant.
drop policy if exists "Tenant members can view notes" on public.crm_notes;
create policy "Tenant members can view notes"
  on public.crm_notes
  for select
  to authenticated
  using (
    tenant_id in (
      select membership.tenant_id
      from public.tenant_memberships as membership
      where membership.profile_id = (select auth.uid())
    )
    and (
      relationship_contact_id is null
      or (
        public.is_staff_or_admin((select auth.uid()))
        and public.is_tenant_member((select auth.uid()), tenant_id)
      )
    )
  );

create or replace function public.submit_website_creator_interest(p_payload jsonb)
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
  v_contact_source_key text;
  v_contact_id uuid;
  v_source_contact_id uuid;
  v_email_contact_id uuid;
  v_email_match_count integer;
  v_veteran_affiliation text;
  v_profile_complete boolean;
  v_key text;
  v_role text;
  v_social jsonb;
  v_platform text;
  v_handle text;
  v_profile_url text;
  v_follower_count bigint;
  v_social_source_key text;
  v_social_id uuid;
  v_highest_platform text;
  v_highest_follower_count bigint;
  v_existing_submission_needs_review boolean;
  v_existing_submission_matches boolean;
  v_now timestamptz := pg_catalog.now();
begin
  if p_payload is null
     or pg_catalog.jsonb_typeof(p_payload) is distinct from 'object'
     or pg_catalog.octet_length(p_payload::text) > 32768 then
    raise exception using errcode = '22023', message = 'Invalid submission.';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(p_payload) as supplied(key)
    where supplied.key <> all (array[
      'submission_key', 'first_name', 'last_name', 'preferred_name', 'email',
      'phone', 'state', 'veteran_affiliation', 'veteran_connection',
      'motivation', 'participation', 'relationship_types', 'willing_to_share',
      'comfort_level', 'personal_mission', 'fundraising_goal',
      'additional_info', 'consent', 'social_profiles', 'source_page', 'user_agent'
    ]::text[])
  ) then
    raise exception using errcode = '22023', message = 'Invalid submission.';
  end if;

  foreach v_key in array array[
    'submission_key', 'first_name', 'last_name', 'preferred_name', 'email',
    'phone', 'state', 'veteran_affiliation', 'veteran_connection',
    'motivation', 'participation', 'comfort_level', 'personal_mission',
    'fundraising_goal', 'additional_info', 'source_page', 'user_agent'
  ]::text[] loop
    if p_payload ? v_key
       and p_payload -> v_key <> 'null'::jsonb
       and pg_catalog.jsonb_typeof(p_payload -> v_key) <> 'string' then
      raise exception using errcode = '22023', message = 'Invalid submission.';
    end if;
  end loop;

  foreach v_key in array array['willing_to_share', 'consent']::text[] loop
    if p_payload ? v_key
       and p_payload -> v_key <> 'null'::jsonb
       and pg_catalog.jsonb_typeof(p_payload -> v_key) <> 'boolean' then
      raise exception using errcode = '22023', message = 'Invalid submission.';
    end if;
  end loop;

  if pg_catalog.jsonb_typeof(p_payload -> 'relationship_types') is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Invalid submission.';
  end if;

  if pg_catalog.jsonb_array_length(p_payload -> 'relationship_types') not between 1 and 12 then
    raise exception using errcode = '22023', message = 'Invalid submission.';
  end if;

  if p_payload ? 'social_profiles'
     and p_payload -> 'social_profiles' <> 'null'::jsonb
     and pg_catalog.jsonb_typeof(p_payload -> 'social_profiles') <> 'array' then
    raise exception using errcode = '22023', message = 'Invalid submission.';
  end if;

  if pg_catalog.jsonb_array_length(
       coalesce(nullif(p_payload -> 'social_profiles', 'null'::jsonb), '[]'::jsonb)
     ) > 10 then
    raise exception using errcode = '22023', message = 'Invalid submission.';
  end if;

  v_submission_key := pg_catalog.btrim(p_payload ->> 'submission_key');
  v_email := pg_catalog.lower(pg_catalog.btrim(p_payload ->> 'email'));
  v_veteran_affiliation := coalesce(
    nullif(pg_catalog.btrim(p_payload ->> 'veteran_affiliation'), ''),
    'unknown'
  );

  if v_submission_key is null
     or pg_catalog.length(v_submission_key) not between 8 and 128
     or v_submission_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
     or nullif(pg_catalog.btrim(p_payload ->> 'first_name'), '') is null
     or pg_catalog.length(pg_catalog.btrim(p_payload ->> 'first_name')) > 100
     or nullif(pg_catalog.btrim(p_payload ->> 'last_name'), '') is null
     or pg_catalog.length(pg_catalog.btrim(p_payload ->> 'last_name')) > 100
     or pg_catalog.length(coalesce(pg_catalog.btrim(p_payload ->> 'preferred_name'), '')) > 100
     or v_email is null
     or pg_catalog.length(v_email) > 254
     or v_email !~ '^[a-z0-9!#$%&''*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&''*+/=?^_`{|}~-]+)*@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
     or pg_catalog.length(coalesce(pg_catalog.btrim(p_payload ->> 'phone'), '')) > 40
     or nullif(pg_catalog.btrim(p_payload ->> 'state'), '') is null
     or pg_catalog.upper(pg_catalog.btrim(p_payload ->> 'state')) <> all (array[
       'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
       'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
       'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
       'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
       'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
       'DC', 'PR', 'GU', 'VI', 'AS', 'MP', 'AE', 'AA', 'AP'
     ]::text[])
     or v_veteran_affiliation <> all (array[
       'unknown', 'veteran', 'family_member', 'military_connected', 'none'
     ]::text[])
     or pg_catalog.length(coalesce(pg_catalog.btrim(p_payload ->> 'veteran_connection'), '')) > 1000
     or nullif(pg_catalog.btrim(p_payload ->> 'motivation'), '') is null
     or pg_catalog.length(pg_catalog.btrim(p_payload ->> 'motivation')) > 4000
     or nullif(pg_catalog.btrim(p_payload ->> 'participation'), '') is null
     or pg_catalog.length(pg_catalog.btrim(p_payload ->> 'participation')) > 4000
     or pg_catalog.length(coalesce(pg_catalog.btrim(p_payload ->> 'comfort_level'), '')) > 40
     or (
       nullif(pg_catalog.btrim(p_payload ->> 'comfort_level'), '') is not null
       and pg_catalog.btrim(p_payload ->> 'comfort_level') <> all (array[
         'public_story', 'private_conversation', 'behind_the_scenes',
         'flexible', 'not_sure'
       ]::text[])
     )
     or pg_catalog.length(coalesce(pg_catalog.btrim(p_payload ->> 'personal_mission'), '')) > 4000
     or pg_catalog.length(coalesce(pg_catalog.btrim(p_payload ->> 'fundraising_goal'), '')) > 1000
     or pg_catalog.length(coalesce(pg_catalog.btrim(p_payload ->> 'additional_info'), '')) > 8000
     or pg_catalog.length(coalesce(pg_catalog.btrim(p_payload ->> 'source_page'), '')) > 200
     or pg_catalog.length(coalesce(pg_catalog.btrim(p_payload ->> 'user_agent'), '')) > 500
     or coalesce((p_payload ->> 'consent')::boolean, false) is not true then
    raise exception using errcode = '22023', message = 'Invalid submission.';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_payload -> 'relationship_types') as role_item(value)
    where pg_catalog.jsonb_typeof(role_item.value) <> 'string'
       or role_item.value #>> '{}' <> all (array[
         'creator', 'bty_promoter', 'storyteller', 'bty_story_submitter',
         'podcaster', 'connector', 'funder', 'supporter',
         'general_mission_interest'
       ]::text[])
  ) then
    raise exception using errcode = '22023', message = 'Invalid submission.';
  end if;

  for v_social in
    select social_item.value
    from pg_catalog.jsonb_array_elements(
      coalesce(nullif(p_payload -> 'social_profiles', 'null'::jsonb), '[]'::jsonb)
    ) as social_item(value)
  loop
    if pg_catalog.jsonb_typeof(v_social) <> 'object' then
      raise exception using errcode = '22023', message = 'Invalid submission.';
    end if;

    if exists (
         select 1
         from pg_catalog.jsonb_object_keys(v_social) as social_key(key)
         where social_key.key <> all (
           array['platform', 'handle', 'profile_url', 'follower_count']::text[]
         )
       )
       or pg_catalog.jsonb_typeof(v_social -> 'platform') is distinct from 'string'
       or (
         v_social ? 'handle'
         and v_social -> 'handle' <> 'null'::jsonb
         and pg_catalog.jsonb_typeof(v_social -> 'handle') <> 'string'
       )
       or (
         v_social ? 'profile_url'
         and v_social -> 'profile_url' <> 'null'::jsonb
         and pg_catalog.jsonb_typeof(v_social -> 'profile_url') <> 'string'
       )
       or (
         v_social ? 'follower_count'
         and v_social -> 'follower_count' <> 'null'::jsonb
         and (
           pg_catalog.jsonb_typeof(v_social -> 'follower_count') <> 'number'
           or v_social ->> 'follower_count' !~ '^[0-9]+$'
           or pg_catalog.length(v_social ->> 'follower_count') > 10
         )
       ) then
      raise exception using errcode = '22023', message = 'Invalid submission.';
    end if;

    v_platform := pg_catalog.btrim(
      pg_catalog.regexp_replace(
        pg_catalog.lower(pg_catalog.btrim(v_social ->> 'platform')),
        '[^a-z0-9]+',
        '_',
        'g'
      ),
      '_'
    );
    v_platform := case v_platform
      when 'x_twitter' then 'x'
      when 'twitter_x' then 'x'
      when 'twitter' then 'x'
      else v_platform
    end;
    v_handle := nullif(pg_catalog.ltrim(pg_catalog.btrim(v_social ->> 'handle'), '@'), '');
    v_profile_url := nullif(pg_catalog.btrim(v_social ->> 'profile_url'), '');

    if v_platform <> all (array[
         'instagram', 'facebook', 'youtube', 'tiktok', 'linkedin', 'x',
         'bluesky', 'threads', 'twitch', 'podcast', 'patreon', 'reddit',
         'website', 'other'
       ]::text[])
       or pg_catalog.length(coalesce(v_handle, '')) > 200
       or pg_catalog.length(coalesce(v_profile_url, '')) > 500
       or (v_handle is null and v_profile_url is null)
       or (v_profile_url is not null and v_profile_url !~* '^https://[^[:space:]]+$')
       or (
         v_social -> 'follower_count' <> 'null'::jsonb
         and (v_social ->> 'follower_count')::numeric > 2147483647
       ) then
      raise exception using errcode = '22023', message = 'Invalid submission.';
    end if;
  end loop;

  select tenant.id
  into strict v_tenant_id
  from public.tenants as tenant
  where tenant.slug = 'valorwell';

  -- Always acquire the request-key lock first, then the normalized-email lock.
  -- This makes a replay safe even if a caller changes the email while also
  -- serializing different requests for one canonical contact.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('creator-interest-request:' || v_submission_key, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('creator-interest:' || v_email, 0)
  );

  v_submission_source_key := 'request:' || v_submission_key;
  select
    submission.status = 'reviewing' and submission.contact_id is null,
    submission.payload = p_payload
      and pg_catalog.lower(pg_catalog.btrim(submission.payload ->> 'email')) = v_email
  into v_existing_submission_needs_review, v_existing_submission_matches
    from public.website_submissions as submission
    where submission.tenant_id = v_tenant_id
      and submission.source_system = 'valorwell_website_interest'
      and submission.source_record_key = v_submission_source_key;

  if found then
    if not coalesce(v_existing_submission_matches, false) then
      raise exception using
        errcode = 'P0001',
        message = 'Unable to submit interest right now.';
    end if;
    if v_existing_submission_needs_review then
      return pg_catalog.jsonb_build_object('ok', true, 'needs_review', true);
    end if;
    return pg_catalog.jsonb_build_object('ok', true);
  end if;

  if (
    select count(*)
    from public.website_submissions as submission
    where submission.tenant_id = v_tenant_id
      and submission.source_system = 'valorwell_website_interest'
      and submission.submission_type = 'interest_submission'
      and submission.submitted_at >= v_now - interval '1 hour'
      and pg_catalog.lower(
        pg_catalog.btrim(submission.payload ->> 'email')
      ) = v_email
  ) >= 5 then
    raise exception using
      errcode = 'P0001',
      message = 'Unable to submit interest right now.';
  end if;

  v_contact_source_key := 'email:' || pg_catalog.md5(v_email);

  select contact.id
  into v_source_contact_id
  from public.relationship_contacts as contact
  where contact.tenant_id = v_tenant_id
    and contact.source = 'valorwell_website_interest'
    and contact.source_record_key = v_contact_source_key
  limit 1;

  select count(*), (pg_catalog.array_agg(contact.id order by contact.id))[1]
  into v_email_match_count, v_email_contact_id
  from public.relationship_contacts as contact
  where contact.tenant_id = v_tenant_id
    and pg_catalog.lower(pg_catalog.btrim(contact.email)) = v_email;

  -- This branch is defensive: the current unique normalized-email index prevents
  -- multiple matches, while a disagreeing explicit source mapping is still
  -- possible after a manual correction. Preserve the raw request for staff review
  -- and do not guess which canonical contact should receive structured changes.
  if v_email_match_count > 1
     or (
       v_source_contact_id is not null
       and v_email_contact_id is not null
       and v_source_contact_id <> v_email_contact_id
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
      'interest_submission',
      'creator_promoter_community_interest',
      'partnership_support',
      'valorwell_website_interest',
      v_submission_source_key,
      p_payload,
      true,
      coalesce(nullif(pg_catalog.btrim(p_payload ->> 'source_page'), ''), '/beyondtheyellow'),
      nullif(pg_catalog.btrim(p_payload ->> 'user_agent'), ''),
      'reviewing',
      v_now
    );

    return pg_catalog.jsonb_build_object('ok', true, 'needs_review', true);
  end if;

  v_contact_id := coalesce(v_source_contact_id, v_email_contact_id);

  if v_contact_id is null then
    insert into public.relationship_contacts (
      tenant_id,
      profile_id,
      first_name,
      last_name,
      preferred_name,
      email,
      phone,
      state,
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
      nullif(pg_catalog.btrim(p_payload ->> 'preferred_name'), ''),
      v_email,
      nullif(pg_catalog.btrim(p_payload ->> 'phone'), ''),
      pg_catalog.upper(pg_catalog.btrim(p_payload ->> 'state')),
      v_veteran_affiliation,
      'new',
      'review_needed',
      'valorwell_website_interest',
      v_contact_source_key,
      pg_catalog.jsonb_build_object(
        'original_lane', 'creator_promoter_community_interest',
        'normalized_lane', 'partnership_support',
        'first_website_interest_at', v_now,
        'latest_website_interest_at', v_now
      )
    )
    returning id into v_contact_id;
  else
    update public.relationship_contacts as contact
    set first_name = coalesce(
          nullif(pg_catalog.btrim(p_payload ->> 'first_name'), ''),
          contact.first_name
        ),
        last_name = coalesce(
          nullif(pg_catalog.btrim(p_payload ->> 'last_name'), ''),
          contact.last_name
        ),
        preferred_name = coalesce(
          nullif(pg_catalog.btrim(p_payload ->> 'preferred_name'), ''),
          contact.preferred_name
        ),
        phone = coalesce(
          nullif(pg_catalog.btrim(p_payload ->> 'phone'), ''),
          contact.phone
        ),
        state = coalesce(
          nullif(pg_catalog.upper(pg_catalog.btrim(p_payload ->> 'state')), ''),
          contact.state
        ),
        veteran_affiliation = case
          when p_payload ? 'veteran_affiliation'
            and v_veteran_affiliation <> 'unknown'
          then v_veteran_affiliation
          else contact.veteran_affiliation
        end,
        metadata = coalesce(contact.metadata, '{}'::jsonb)
          || pg_catalog.jsonb_build_object(
            'latest_website_interest_at', v_now,
            'latest_website_interest_source', 'valorwell_website_interest'
          ),
        updated_at = v_now
    where contact.id = v_contact_id;
  end if;

  v_profile_complete :=
    nullif(pg_catalog.btrim(p_payload ->> 'first_name'), '') is not null
    and nullif(pg_catalog.btrim(p_payload ->> 'last_name'), '') is not null
    and v_email is not null
    and nullif(pg_catalog.btrim(p_payload ->> 'state'), '') is not null
    and nullif(pg_catalog.btrim(p_payload ->> 'motivation'), '') is not null
    and nullif(pg_catalog.btrim(p_payload ->> 'participation'), '') is not null
    and pg_catalog.jsonb_array_length(p_payload -> 'relationship_types') > 0
    and (p_payload ->> 'consent')::boolean;

  insert into public.relationship_influencer_profiles (
    contact_id,
    tenant_id,
    status,
    motivation,
    veteran_connection,
    willing_to_share,
    comfort_level,
    fundraising_goal,
    additional_info,
    accepted_rules,
    personal_mission,
    profile_complete,
    source,
    source_record_key,
    metadata
  ) values (
    v_contact_id,
    v_tenant_id,
    'new',
    pg_catalog.btrim(p_payload ->> 'motivation'),
    nullif(pg_catalog.btrim(p_payload ->> 'veteran_connection'), ''),
    case when p_payload ? 'willing_to_share'
      then (p_payload ->> 'willing_to_share')::boolean else null end,
    nullif(pg_catalog.btrim(p_payload ->> 'comfort_level'), ''),
    nullif(pg_catalog.btrim(p_payload ->> 'fundraising_goal'), ''),
    nullif(pg_catalog.btrim(p_payload ->> 'additional_info'), ''),
    true,
    nullif(pg_catalog.btrim(p_payload ->> 'personal_mission'), ''),
    v_profile_complete,
    'valorwell_website_interest',
    v_contact_source_key,
    pg_catalog.jsonb_build_object(
      'participation', pg_catalog.btrim(p_payload ->> 'participation'),
      'latest_website_interest_at', v_now
    )
  )
  on conflict (contact_id) do update
  set motivation = coalesce(
        nullif(excluded.motivation, ''),
        relationship_influencer_profiles.motivation
      ),
      veteran_connection = coalesce(
        nullif(excluded.veteran_connection, ''),
        relationship_influencer_profiles.veteran_connection
      ),
      willing_to_share = coalesce(
        excluded.willing_to_share,
        relationship_influencer_profiles.willing_to_share
      ),
      comfort_level = coalesce(
        nullif(excluded.comfort_level, ''),
        relationship_influencer_profiles.comfort_level
      ),
      fundraising_goal = coalesce(
        nullif(excluded.fundraising_goal, ''),
        relationship_influencer_profiles.fundraising_goal
      ),
      additional_info = coalesce(
        nullif(excluded.additional_info, ''),
        relationship_influencer_profiles.additional_info
      ),
      accepted_rules = coalesce(relationship_influencer_profiles.accepted_rules, false)
        or excluded.accepted_rules,
      personal_mission = coalesce(
        nullif(excluded.personal_mission, ''),
        relationship_influencer_profiles.personal_mission
      ),
      profile_complete = coalesce(relationship_influencer_profiles.profile_complete, false)
        or excluded.profile_complete,
      metadata = coalesce(relationship_influencer_profiles.metadata, '{}'::jsonb)
        || excluded.metadata,
      updated_at = v_now;

  for v_role in
    select distinct role_item.value #>> '{}'
    from pg_catalog.jsonb_array_elements(p_payload -> 'relationship_types') as role_item(value)
  loop
    insert into public.relationship_contact_roles (
      tenant_id,
      contact_id,
      role_code,
      source,
      metadata
    ) values (
      v_tenant_id,
      v_contact_id,
      v_role,
      'valorwell_website_interest',
      pg_catalog.jsonb_build_object('latest_website_interest_at', v_now)
    )
    on conflict (contact_id, role_code) do nothing;
  end loop;

  for v_social in
    select social_item.value
    from pg_catalog.jsonb_array_elements(
      coalesce(nullif(p_payload -> 'social_profiles', 'null'::jsonb), '[]'::jsonb)
    ) as social_item(value)
  loop
    v_platform := pg_catalog.btrim(
      pg_catalog.regexp_replace(
        pg_catalog.lower(pg_catalog.btrim(v_social ->> 'platform')),
        '[^a-z0-9]+',
        '_',
        'g'
      ),
      '_'
    );
    v_platform := case v_platform
      when 'x_twitter' then 'x'
      when 'twitter_x' then 'x'
      when 'twitter' then 'x'
      else v_platform
    end;
    v_handle := nullif(pg_catalog.ltrim(pg_catalog.btrim(v_social ->> 'handle'), '@'), '');
    v_profile_url := nullif(pg_catalog.btrim(v_social ->> 'profile_url'), '');
    v_follower_count := case
      when v_social -> 'follower_count' is null
        or v_social -> 'follower_count' = 'null'::jsonb
      then null
      else (v_social ->> 'follower_count')::bigint
    end;
    v_social_source_key := 'contact:' || v_contact_id::text
      || ':' || v_platform
      || ':' || pg_catalog.md5(coalesce(pg_catalog.lower(v_handle), pg_catalog.lower(v_profile_url)));

    select social.id
    into v_social_id
    from public.relationship_social_profiles as social
    where social.tenant_id = v_tenant_id
      and social.contact_id = v_contact_id
      and (
        case pg_catalog.btrim(
          pg_catalog.regexp_replace(
            pg_catalog.lower(pg_catalog.btrim(social.platform_name)),
            '[^a-z0-9]+',
            '_',
            'g'
          ),
          '_'
        )
          when 'x_twitter' then 'x'
          when 'twitter_x' then 'x'
          when 'twitter' then 'x'
          else pg_catalog.btrim(
            pg_catalog.regexp_replace(
              pg_catalog.lower(pg_catalog.btrim(social.platform_name)),
              '[^a-z0-9]+',
              '_',
              'g'
            ),
            '_'
          )
        end
      ) = v_platform
      and (
        social.source_record_key = v_social_source_key
        or (
          v_handle is not null
          and pg_catalog.lower(pg_catalog.ltrim(pg_catalog.btrim(social.handle), '@'))
            = pg_catalog.lower(v_handle)
        )
        or (
          v_profile_url is not null
          and pg_catalog.lower(pg_catalog.btrim(social.profile_url))
            = pg_catalog.lower(v_profile_url)
        )
      )
    order by
      (social.source_record_key = v_social_source_key) desc,
      social.created_at,
      social.id
    limit 1;

    if v_social_id is null then
      insert into public.relationship_social_profiles (
        tenant_id,
        contact_id,
        platform_name,
        handle,
        profile_url,
        follower_count,
        approved,
        source,
        source_record_key,
        metadata
      ) values (
        v_tenant_id,
        v_contact_id,
        v_platform,
        v_handle,
        v_profile_url,
        v_follower_count,
        null,
        'valorwell_website_interest',
        v_social_source_key,
        pg_catalog.jsonb_build_object('latest_website_interest_at', v_now)
      );
    else
      update public.relationship_social_profiles as social
      set handle = coalesce(v_handle, social.handle),
          profile_url = coalesce(v_profile_url, social.profile_url),
          follower_count = case
            when social.follower_count is null then v_follower_count
            when v_follower_count is null then social.follower_count
            else greatest(social.follower_count, v_follower_count)
          end,
          metadata = coalesce(social.metadata, '{}'::jsonb)
            || pg_catalog.jsonb_build_object('latest_website_interest_at', v_now),
          updated_at = v_now
      where social.id = v_social_id;
    end if;
  end loop;

  select social.platform_name, social.follower_count
  into v_highest_platform, v_highest_follower_count
  from public.relationship_social_profiles as social
  where social.tenant_id = v_tenant_id
    and social.contact_id = v_contact_id
    and social.follower_count is not null
  order by social.follower_count desc, social.created_at, social.id
  limit 1;

  if v_highest_follower_count is not null then
    update public.relationship_influencer_profiles as profile
    set highest_follower_platform = case
          when profile.highest_follower_count is null
            or v_highest_follower_count > profile.highest_follower_count
          then v_highest_platform
          else profile.highest_follower_platform
        end,
        highest_follower_count = case
          when profile.highest_follower_count is null
          then v_highest_follower_count
          else greatest(profile.highest_follower_count, v_highest_follower_count)
        end,
        updated_at = v_now
    where profile.contact_id = v_contact_id;
  end if;

  insert into public.website_submissions (
    tenant_id,
    submission_type,
    original_lane,
    normalized_lane,
    contact_id,
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
    'interest_submission',
    'creator_promoter_community_interest',
    'partnership_support',
    v_contact_id,
    'valorwell_website_interest',
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
    raise exception using errcode = '22023', message = 'Invalid submission.';
  when others then
    raise exception using errcode = 'P0001', message = 'Unable to submit interest right now.';
end
$function$;

comment on function public.submit_website_creator_interest(jsonb) is
  'Anonymous, validation-first creator/promoter/community-interest intake. Does not create or link Auth users.';

create or replace function public.update_creator_interest_record(
  p_tenant_id uuid,
  p_contact_id uuid,
  p_contact_changes jsonb,
  p_profile_changes jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_contact_changes jsonb := coalesce(
    nullif(p_contact_changes, 'null'::jsonb),
    '{}'::jsonb
  );
  v_profile_changes jsonb := coalesce(
    nullif(p_profile_changes, 'null'::jsonb),
    '{}'::jsonb
  );
  v_key text;
  v_is_service_role boolean := current_user = 'service_role';
begin
  if p_tenant_id is null
     or p_contact_id is null
     or pg_catalog.jsonb_typeof(v_contact_changes) <> 'object'
     or pg_catalog.jsonb_typeof(v_profile_changes) <> 'object'
     or (v_contact_changes = '{}'::jsonb and v_profile_changes = '{}'::jsonb)
     or pg_catalog.octet_length(v_contact_changes::text) > 16384
     or pg_catalog.octet_length(v_profile_changes::text) > 16384 then
    raise exception 'Unable to update interest record.';
  end if;

  if not v_is_service_role and (
    (select auth.uid()) is null
    or not public.is_staff_or_admin((select auth.uid()))
    or not public.is_tenant_member((select auth.uid()), p_tenant_id)
  ) then
    raise exception 'Unable to update interest record.';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(v_contact_changes) as supplied(key)
    where supplied.key <> all (array[
      'first_name', 'last_name', 'preferred_name', 'email', 'phone', 'state',
      'veteran_affiliation', 'outreach_status', 'owner_profile_id',
      'next_action', 'next_action_due_at', 'last_contact_at', 'do_not_contact',
      'review_state'
    ]::text[])
  ) or exists (
    select 1
    from pg_catalog.jsonb_object_keys(v_profile_changes) as supplied(key)
    where supplied.key <> all (array[
      'motivation', 'veteran_connection', 'willing_to_share', 'comfort_level',
      'fundraising_goal', 'additional_info', 'accepted_rules',
      'personal_mission', 'profile_complete'
    ]::text[])
  ) then
    raise exception 'Unable to update interest record.';
  end if;

  foreach v_key in array array[
    'first_name', 'last_name', 'preferred_name', 'email', 'phone', 'state',
    'veteran_affiliation', 'outreach_status', 'owner_profile_id',
    'next_action', 'next_action_due_at', 'last_contact_at', 'review_state'
  ]::text[] loop
    if v_contact_changes ? v_key
       and v_contact_changes -> v_key <> 'null'::jsonb
       and pg_catalog.jsonb_typeof(v_contact_changes -> v_key) <> 'string' then
      raise exception 'Unable to update interest record.';
    end if;
  end loop;

  if v_contact_changes ? 'do_not_contact'
     and (
       v_contact_changes -> 'do_not_contact' = 'null'::jsonb
       or pg_catalog.jsonb_typeof(v_contact_changes -> 'do_not_contact') <> 'boolean'
     ) then
    raise exception 'Unable to update interest record.';
  end if;

  foreach v_key in array array[
    'motivation', 'veteran_connection', 'comfort_level', 'fundraising_goal',
    'additional_info', 'personal_mission'
  ]::text[] loop
    if v_profile_changes ? v_key
       and v_profile_changes -> v_key <> 'null'::jsonb
       and pg_catalog.jsonb_typeof(v_profile_changes -> v_key) <> 'string' then
      raise exception 'Unable to update interest record.';
    end if;
  end loop;

  foreach v_key in array array[
    'willing_to_share', 'accepted_rules', 'profile_complete'
  ]::text[] loop
    if v_profile_changes ? v_key
       and v_profile_changes -> v_key <> 'null'::jsonb
       and pg_catalog.jsonb_typeof(v_profile_changes -> v_key) <> 'boolean' then
      raise exception 'Unable to update interest record.';
    end if;
  end loop;

  if (
       v_contact_changes ? 'first_name'
       and (
         nullif(pg_catalog.btrim(v_contact_changes ->> 'first_name'), '') is null
         or pg_catalog.length(pg_catalog.btrim(v_contact_changes ->> 'first_name')) > 100
       )
     )
     or (
       v_contact_changes ? 'last_name'
       and (
         nullif(pg_catalog.btrim(v_contact_changes ->> 'last_name'), '') is null
         or pg_catalog.length(pg_catalog.btrim(v_contact_changes ->> 'last_name')) > 100
       )
     )
     or pg_catalog.length(coalesce(pg_catalog.btrim(v_contact_changes ->> 'preferred_name'), '')) > 100
     or (
       v_contact_changes ? 'email'
       and (
         nullif(pg_catalog.lower(pg_catalog.btrim(v_contact_changes ->> 'email')), '') is null
         or pg_catalog.length(pg_catalog.btrim(v_contact_changes ->> 'email')) > 254
         or pg_catalog.lower(pg_catalog.btrim(v_contact_changes ->> 'email'))
           !~ '^[a-z0-9!#$%&''*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&''*+/=?^_`{|}~-]+)*@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
       )
     )
     or pg_catalog.length(coalesce(pg_catalog.btrim(v_contact_changes ->> 'phone'), '')) > 40
     or (
       v_contact_changes ? 'state'
       and (
         v_contact_changes -> 'state' = 'null'::jsonb
         or pg_catalog.upper(pg_catalog.btrim(v_contact_changes ->> 'state')) <> all (array[
           'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
           'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
           'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
           'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
           'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
           'DC', 'PR', 'GU', 'VI', 'AS', 'MP', 'AE', 'AA', 'AP'
         ]::text[])
       )
     )
     or (
       v_contact_changes ? 'veteran_affiliation'
       and (
         v_contact_changes -> 'veteran_affiliation' = 'null'::jsonb
         or v_contact_changes ->> 'veteran_affiliation' <> all (array[
           'unknown', 'veteran', 'family_member', 'military_connected', 'none'
         ]::text[])
       )
     )
     or (
       v_contact_changes ? 'outreach_status'
       and (
         v_contact_changes -> 'outreach_status' = 'null'::jsonb
         or v_contact_changes ->> 'outreach_status' <> all (array[
           'new', 'reviewing', 'contacted', 'engaged', 'waiting', 'closed',
           'do_not_contact'
         ]::text[])
       )
     )
     or (
       v_contact_changes ? 'review_state'
       and (
         v_contact_changes -> 'review_state' = 'null'::jsonb
         or v_contact_changes ->> 'review_state' <> all (array[
           'review_needed', 'direct_outreach', 'nurture', 'not_relevant',
           'duplicate', 'invalid_spam', 'managed'
         ]::text[])
       )
     )
     or pg_catalog.length(coalesce(pg_catalog.btrim(v_contact_changes ->> 'next_action'), '')) > 1000
     or pg_catalog.length(coalesce(pg_catalog.btrim(v_profile_changes ->> 'motivation'), '')) > 4000
     or pg_catalog.length(coalesce(pg_catalog.btrim(v_profile_changes ->> 'veteran_connection'), '')) > 1000
     or pg_catalog.length(coalesce(pg_catalog.btrim(v_profile_changes ->> 'fundraising_goal'), '')) > 1000
     or pg_catalog.length(coalesce(pg_catalog.btrim(v_profile_changes ->> 'additional_info'), '')) > 8000
     or pg_catalog.length(coalesce(pg_catalog.btrim(v_profile_changes ->> 'personal_mission'), '')) > 4000
     or (
       v_profile_changes ? 'comfort_level'
       and v_profile_changes -> 'comfort_level' <> 'null'::jsonb
       and v_profile_changes ->> 'comfort_level' <> all (array[
         'public_story', 'private_conversation', 'behind_the_scenes',
         'flexible', 'not_sure'
       ]::text[])
     ) then
    raise exception 'Unable to update interest record.';
  end if;

  -- Cast validation occurs before either UPDATE so malformed UUID/timestamps
  -- cannot leave a partially corrected contact.
  if v_contact_changes ? 'owner_profile_id'
     and v_contact_changes -> 'owner_profile_id' <> 'null'::jsonb then
    perform (v_contact_changes ->> 'owner_profile_id')::uuid;
  end if;
  if v_contact_changes ? 'next_action_due_at'
     and v_contact_changes -> 'next_action_due_at' <> 'null'::jsonb then
    perform (v_contact_changes ->> 'next_action_due_at')::timestamptz;
  end if;
  if v_contact_changes ? 'last_contact_at'
     and v_contact_changes -> 'last_contact_at' <> 'null'::jsonb then
    perform (v_contact_changes ->> 'last_contact_at')::timestamptz;
  end if;

  perform 1
  from public.relationship_contacts as contact
  where contact.id = p_contact_id
    and contact.tenant_id = p_tenant_id
  for update;
  if not found then
    raise exception 'Unable to update interest record.';
  end if;

  if v_profile_changes <> '{}'::jsonb then
    perform 1
    from public.relationship_influencer_profiles as profile
    where profile.contact_id = p_contact_id
      and profile.tenant_id = p_tenant_id
    for update;
    if not found then
      raise exception 'Unable to update interest record.';
    end if;
  end if;

  if v_contact_changes <> '{}'::jsonb then
    update public.relationship_contacts as contact
    set first_name = case when v_contact_changes ? 'first_name'
          then pg_catalog.btrim(v_contact_changes ->> 'first_name') else contact.first_name end,
        last_name = case when v_contact_changes ? 'last_name'
          then pg_catalog.btrim(v_contact_changes ->> 'last_name') else contact.last_name end,
        preferred_name = case when v_contact_changes ? 'preferred_name'
          then nullif(pg_catalog.btrim(v_contact_changes ->> 'preferred_name'), '') else contact.preferred_name end,
        email = case when v_contact_changes ? 'email'
          then pg_catalog.lower(pg_catalog.btrim(v_contact_changes ->> 'email')) else contact.email end,
        phone = case when v_contact_changes ? 'phone'
          then nullif(pg_catalog.btrim(v_contact_changes ->> 'phone'), '') else contact.phone end,
        state = case when v_contact_changes ? 'state'
          then pg_catalog.upper(pg_catalog.btrim(v_contact_changes ->> 'state')) else contact.state end,
        veteran_affiliation = case when v_contact_changes ? 'veteran_affiliation'
          then v_contact_changes ->> 'veteran_affiliation' else contact.veteran_affiliation end,
        outreach_status = case when v_contact_changes ? 'outreach_status'
          then v_contact_changes ->> 'outreach_status' else contact.outreach_status end,
        owner_profile_id = case when v_contact_changes ? 'owner_profile_id'
          then (v_contact_changes ->> 'owner_profile_id')::uuid else contact.owner_profile_id end,
        next_action = case when v_contact_changes ? 'next_action'
          then nullif(pg_catalog.btrim(v_contact_changes ->> 'next_action'), '') else contact.next_action end,
        next_action_due_at = case when v_contact_changes ? 'next_action_due_at'
          then (v_contact_changes ->> 'next_action_due_at')::timestamptz else contact.next_action_due_at end,
        last_contact_at = case when v_contact_changes ? 'last_contact_at'
          then (v_contact_changes ->> 'last_contact_at')::timestamptz else contact.last_contact_at end,
        do_not_contact = case when v_contact_changes ? 'do_not_contact'
          then (v_contact_changes ->> 'do_not_contact')::boolean else contact.do_not_contact end,
        review_state = case when v_contact_changes ? 'review_state'
          then v_contact_changes ->> 'review_state' else contact.review_state end,
        updated_at = pg_catalog.now()
    where contact.id = p_contact_id
      and contact.tenant_id = p_tenant_id;

    if not found then
      raise exception 'Unable to update interest record.';
    end if;
  end if;

  if v_profile_changes <> '{}'::jsonb then
    update public.relationship_influencer_profiles as profile
    set motivation = case when v_profile_changes ? 'motivation'
          then nullif(pg_catalog.btrim(v_profile_changes ->> 'motivation'), '') else profile.motivation end,
        veteran_connection = case when v_profile_changes ? 'veteran_connection'
          then nullif(pg_catalog.btrim(v_profile_changes ->> 'veteran_connection'), '') else profile.veteran_connection end,
        willing_to_share = case when v_profile_changes ? 'willing_to_share'
          then (v_profile_changes ->> 'willing_to_share')::boolean else profile.willing_to_share end,
        comfort_level = case when v_profile_changes ? 'comfort_level'
          then nullif(pg_catalog.btrim(v_profile_changes ->> 'comfort_level'), '') else profile.comfort_level end,
        fundraising_goal = case when v_profile_changes ? 'fundraising_goal'
          then nullif(pg_catalog.btrim(v_profile_changes ->> 'fundraising_goal'), '') else profile.fundraising_goal end,
        additional_info = case when v_profile_changes ? 'additional_info'
          then nullif(pg_catalog.btrim(v_profile_changes ->> 'additional_info'), '') else profile.additional_info end,
        accepted_rules = case when v_profile_changes ? 'accepted_rules'
          then (v_profile_changes ->> 'accepted_rules')::boolean else profile.accepted_rules end,
        personal_mission = case when v_profile_changes ? 'personal_mission'
          then nullif(pg_catalog.btrim(v_profile_changes ->> 'personal_mission'), '') else profile.personal_mission end,
        profile_complete = case when v_profile_changes ? 'profile_complete'
          then (v_profile_changes ->> 'profile_complete')::boolean else profile.profile_complete end,
        updated_at = pg_catalog.now()
    where profile.contact_id = p_contact_id
      and profile.tenant_id = p_tenant_id;

    if not found then
      raise exception 'Unable to update interest record.';
    end if;
  end if;

  return pg_catalog.jsonb_build_object('ok', true);
exception
  when others then
    raise exception using
      errcode = 'P0001',
      message = 'Unable to update interest record.';
end
$function$;

comment on function public.update_creator_interest_record(uuid, uuid, jsonb, jsonb) is
  'Authenticated, tenant-scoped, atomic contact and interest-profile correction contract. Derived and historical fields are read-only.';

-- Anonymous callers receive no direct table privileges. The only public write
-- surface introduced by this migration is the validated wrapper above.
revoke all on table public.relationship_contacts from anon;
revoke all on table public.relationship_influencer_profiles from anon;
revoke all on table public.relationship_contact_roles from anon;
revoke all on table public.relationship_social_profiles from anon;
revoke all on table public.website_submissions from anon;
revoke all on table public.crm_notes from anon;
revoke all on table public.relationship_role_catalog from anon;
revoke all on table public.relationship_interest_submission_conflicts from public;
revoke all on table public.relationship_interest_submission_conflicts from anon;

-- Authenticated application users retain only the DML needed by the existing RLS
-- model. Catalog mutation remains service-only.
revoke truncate, references, trigger
  on table public.relationship_contacts,
    public.relationship_influencer_profiles,
    public.relationship_contact_roles,
    public.relationship_social_profiles,
    public.website_submissions,
    public.crm_notes
  from authenticated;
grant select, insert, update, delete
  on table public.relationship_contacts,
    public.relationship_influencer_profiles,
    public.relationship_contact_roles,
    public.relationship_social_profiles,
    public.crm_notes
  to authenticated;
grant select, insert, update, delete
  on table public.website_submissions to authenticated;

grant select on table public.relationship_interest_submission_conflicts
  to authenticated, service_role;

revoke all on function public.submit_website_creator_interest(jsonb) from public;
revoke all on function public.submit_website_creator_interest(jsonb) from anon;
revoke all on function public.submit_website_creator_interest(jsonb) from authenticated;
revoke all on function public.submit_website_creator_interest(jsonb) from service_role;
grant execute on function public.submit_website_creator_interest(jsonb)
  to anon, authenticated, service_role;

revoke all on function public.update_creator_interest_record(uuid, uuid, jsonb, jsonb)
  from public;
revoke all on function public.update_creator_interest_record(uuid, uuid, jsonb, jsonb)
  from anon;
revoke all on function public.update_creator_interest_record(uuid, uuid, jsonb, jsonb)
  from authenticated;
revoke all on function public.update_creator_interest_record(uuid, uuid, jsonb, jsonb)
  from service_role;
grant execute on function public.update_creator_interest_record(uuid, uuid, jsonb, jsonb)
  to authenticated, service_role;
