-- Rollback-safe database verification for 20260717225018.
-- Run with a privileged SQL session after the migration is applied. Every test
-- row is created inside this transaction and the final ROLLBACK removes it.

begin;

create or replace function pg_temp.assert_true(p_condition boolean, p_message text)
returns void
language plpgsql
as $test$
begin
  if p_condition is not true then
    raise exception 'verification failed: %', p_message;
  end if;
end
$test$;

create or replace function pg_temp.expect_invalid(p_payload jsonb, p_case text)
returns void
language plpgsql
as $test$
begin
  begin
    perform public.submit_website_creator_interest(p_payload);
    raise exception 'verification failed: % was accepted', p_case;
  exception
    when sqlstate '22023' then
      null;
  end;
end
$test$;

create or replace function pg_temp.expect_unavailable(p_payload jsonb, p_case text)
returns void
language plpgsql
as $test$
declare
  v_failed boolean := false;
begin
  begin
    perform public.submit_website_creator_interest(p_payload);
  exception when sqlstate 'P0001' then
    v_failed := true;
  end;

  if not v_failed then
    raise exception 'verification failed: % was accepted', p_case;
  end if;
end
$test$;

create temporary table creator_interest_test_baseline (
  auth_user_count bigint not null
) on commit drop;

insert into creator_interest_test_baseline (auth_user_count)
select count(*) from auth.users;

select set_config('creator_interest_test.client_profile_id', gen_random_uuid()::text, true);
select set_config('creator_interest_test.other_staff_profile_id', gen_random_uuid()::text, true);

insert into public.profiles (id, email)
values
  (current_setting('creator_interest_test.client_profile_id')::uuid,
   'creator-interest-client-principal@example.invalid'),
  (current_setting('creator_interest_test.other_staff_profile_id')::uuid,
   'creator-interest-other-staff@example.invalid');

insert into public.user_roles (user_id, role)
values
  (current_setting('creator_interest_test.client_profile_id')::uuid, 'client'),
  (current_setting('creator_interest_test.other_staff_profile_id')::uuid, 'staff');

insert into public.tenant_memberships (tenant_id, profile_id)
values (
  (select id from public.tenants where slug = 'valorwell'),
  current_setting('creator_interest_test.client_profile_id')::uuid
);

select pg_temp.assert_true(
  (
    select review_state = 'review_needed'
    from public.relationship_contacts
    where source_record_key = 'historical-interest-fixture'
  ) and (
    select review_state is null
    from public.relationship_contacts
    where source_record_key = 'clinician-fixture'
  ),
  'targeted review-state backfill changed an unrelated clinician contact'
);

select pg_temp.assert_true(
  has_table_privilege('authenticated', 'public.website_submissions', 'INSERT')
    and has_table_privilege('authenticated', 'public.website_submissions', 'DELETE'),
  'migration removed preexisting authenticated website-submission DML grants'
);

select pg_temp.assert_true(
  has_schema_privilege('authenticated', 'private', 'USAGE')
    and has_schema_privilege('service_role', 'private', 'USAGE'),
  'migration removed preexisting private-schema usage grants'
);

-- The new wrapper must be executable as anon while direct relationship/raw-data
-- access remains unavailable.
set local role anon;

select public.submit_website_creator_interest(
  jsonb_build_object(
    'submission_key', 'db-test-new-0001',
    'first_name', 'Database',
    'last_name', 'Verification',
    'preferred_name', 'DB Test',
    'email', 'creator-interest-db-test@example.invalid',
    'phone', null,
    'state', 'AE',
    'veteran_affiliation', 'military_connected',
    'veteran_connection', 'Rollback-only verification record',
    'motivation', 'Verify the anonymous creator-interest contract.',
    'participation', 'Share educational material and make introductions.',
    'relationship_types', jsonb_build_array('creator', 'connector'),
    'willing_to_share', true,
    'comfort_level', 'behind_the_scenes',
    'personal_mission', 'Database verification only',
    'fundraising_goal', null,
    'additional_info', null,
    'consent', true,
    'social_profiles', jsonb_build_array(
      jsonb_build_object(
        'platform', 'Instagram',
        'handle', '@valorwell_db_test',
        'profile_url', 'https://instagram.com/valorwell_db_test',
        'follower_count', 1200
      ),
      jsonb_build_object(
        'platform', 'Patreon',
        'handle', 'valorwell-db-test',
        'profile_url', 'https://patreon.com/valorwell-db-test',
        'follower_count', null
      )
    ),
    'source_page', '/beyondtheyellow',
    'user_agent', 'database-verification'
  )
);

do $test$
declare
  v_read_denied boolean := false;
  v_insert_denied boolean := false;
  v_raw_read_denied boolean := false;
  v_conflict_view_denied boolean := false;
begin
  begin
    perform count(*) from public.relationship_contacts;
  exception when insufficient_privilege then
    v_read_denied := true;
  end;

  begin
    insert into public.relationship_contacts (
      tenant_id, email, veteran_affiliation, source
    ) values (
      '00000000-0000-0000-0000-000000000001',
      'must-be-denied@example.invalid',
      'unknown',
      'anonymous-direct-write-test'
    );
  exception when insufficient_privilege then
    v_insert_denied := true;
  end;

  begin
    perform count(*) from public.website_submissions;
  exception when insufficient_privilege then
    v_raw_read_denied := true;
  end;

  begin
    perform count(*) from public.relationship_interest_submission_conflicts;
  exception when insufficient_privilege then
    v_conflict_view_denied := true;
  end;

  if not v_read_denied
     or not v_insert_denied
     or not v_raw_read_denied
     or not v_conflict_view_denied then
    raise exception 'verification failed: anon retained direct table access';
  end if;
end
$test$;

reset role;

select pg_temp.assert_true(
  (
    select result = '{"ok": true}'::jsonb
    from (
      select public.submit_website_creator_interest(
        jsonb_build_object(
          'submission_key', 'db-test-new-0001',
          'first_name', 'Database',
          'last_name', 'Verification',
          'preferred_name', 'DB Test',
          'email', 'creator-interest-db-test@example.invalid',
          'phone', null,
          'state', 'AE',
          'veteran_affiliation', 'military_connected',
          'veteran_connection', 'Rollback-only verification record',
          'motivation', 'Verify the anonymous creator-interest contract.',
          'participation', 'Share educational material and make introductions.',
          'relationship_types', jsonb_build_array('creator', 'connector'),
          'willing_to_share', true,
          'comfort_level', 'behind_the_scenes',
          'personal_mission', 'Database verification only',
          'fundraising_goal', null,
          'additional_info', null,
          'consent', true,
          'social_profiles', jsonb_build_array(
            jsonb_build_object(
              'platform', 'Instagram', 'handle', '@valorwell_db_test',
              'profile_url', 'https://instagram.com/valorwell_db_test',
              'follower_count', 1200
            ),
            jsonb_build_object(
              'platform', 'Patreon', 'handle', 'valorwell-db-test',
              'profile_url', 'https://patreon.com/valorwell-db-test',
              'follower_count', null
            )
          ),
          'source_page', '/beyondtheyellow',
          'user_agent', 'database-verification'
        )
      ) as result
    ) as replay
  ),
  'the safe response shape or idempotent replay failed'
);

select pg_temp.expect_unavailable(
  jsonb_build_object(
    'submission_key', 'db-test-new-0001',
    'first_name', 'Different', 'last_name', 'Identity',
    'email', 'different-idempotency-email@example.invalid', 'state', 'TX',
    'motivation', 'Must not be silently dropped.', 'participation', 'test',
    'relationship_types', jsonb_build_array('supporter'), 'consent', true
  ),
  'same request key with materially different identity and payload'
);

select pg_temp.assert_true(
  (
    select count(*) = 1
    from public.relationship_contacts
    where tenant_id = (select id from public.tenants where slug = 'valorwell')
      and lower(email) = 'creator-interest-db-test@example.invalid'
      and profile_id is null
  ),
  'new submission did not create exactly one Auth-unlinked contact'
);

select pg_temp.assert_true(
  (
    select count(*) = 1
    from public.website_submissions
    where source_system = 'valorwell_website_interest'
      and source_record_key = 'request:db-test-new-0001'
  ),
  'idempotent replay created or removed raw history'
);

-- A different request key for the same normalized email must add raw history,
-- reuse the contact, preserve omitted fields, avoid role/social duplicates, and
-- never lower a known follower count.
select public.submit_website_creator_interest(
  jsonb_build_object(
    'submission_key', 'db-test-repeat-0002',
    'first_name', 'Database',
    'last_name', 'Verification',
    'email', '  CREATOR-INTEREST-DB-TEST@example.invalid  ',
    'state', 'AE',
    'motivation', 'A newer motivation is safe to merge.',
    'participation', 'Continue supporting verification.',
    'relationship_types', jsonb_build_array('creator', 'connector', 'supporter'),
    'consent', true,
    'social_profiles', jsonb_build_array(
      jsonb_build_object(
        'platform', 'instagram',
        'handle', 'valorwell_db_test',
        'profile_url', 'https://instagram.com/valorwell_db_test',
        'follower_count', 100
      ),
      jsonb_build_object(
        'platform', 'patreon',
        'handle', 'valorwell-db-test',
        'profile_url', 'https://patreon.com/valorwell-db-test',
        'follower_count', null
      )
    )
  )
);

select pg_temp.assert_true(
  (
    select count(*) = 1
    from public.relationship_contacts
    where lower(email) = 'creator-interest-db-test@example.invalid'
  ),
  'repeat submission created a second contact'
);

select pg_temp.assert_true(
  (
    select count(*) = 2
    from public.website_submissions
    where source_system = 'valorwell_website_interest'
      and contact_id = (
        select id from public.relationship_contacts
        where lower(email) = 'creator-interest-db-test@example.invalid'
      )
  ),
  'distinct repeat request did not preserve a second raw submission'
);

select pg_temp.assert_true(
  (
    select count(*) = 3 and count(*) = count(distinct role_code)
    from public.relationship_contact_roles
    where contact_id = (
      select id from public.relationship_contacts
      where lower(email) = 'creator-interest-db-test@example.invalid'
    )
  ),
  'repeat request duplicated or lost role assignments'
);

select pg_temp.assert_true(
  (
    select count(*) = 2
      and max(follower_count) filter (where platform_name = 'instagram') = 1200
    from public.relationship_social_profiles
    where contact_id = (
      select id from public.relationship_contacts
      where lower(email) = 'creator-interest-db-test@example.invalid'
    )
  ),
  'social upsert duplicated rows or decreased follower count'
);

select pg_temp.assert_true(
  (
    select personal_mission = 'Database verification only'
      and highest_follower_platform = 'instagram'
      and highest_follower_count = 1200
      and status = 'new'
    from public.relationship_influencer_profiles
    where contact_id = (
      select id from public.relationship_contacts
      where lower(email) = 'creator-interest-db-test@example.invalid'
    )
  ),
  'profile merge erased prior data, status, or highest-follower facts'
);

-- Optional fields and social profiles may be absent.
select public.submit_website_creator_interest(
  jsonb_build_object(
    'submission_key', 'db-test-no-social-0003',
    'first_name', 'No',
    'last_name', 'Social',
    'email', 'creator-interest-no-social@example.invalid',
    'state', 'PR',
    'motivation', 'Verify optional fields.',
    'participation', 'Community support.',
    'relationship_types', jsonb_build_array('general_mission_interest'),
    'consent', true,
    'social_profiles', null
  )
);

select pg_temp.assert_true(
  (
    select count(*) = 1
    from public.relationship_influencer_profiles
    where contact_id = (
      select id from public.relationship_contacts
      where lower(email) = 'creator-interest-no-social@example.invalid'
    )
  ) and (
    select count(*) = 0
    from public.relationship_social_profiles
    where contact_id = (
      select id from public.relationship_contacts
      where lower(email) = 'creator-interest-no-social@example.invalid'
    )
  ),
  'null optional fields or zero social profiles failed'
);

-- The first five distinct requests in an hour are accepted. A same-key replay is
-- still idempotent, while a sixth distinct key is rejected without a sixth raw row.
do $test$
declare
  v_attempt integer;
begin
  for v_attempt in 1..5 loop
    perform public.submit_website_creator_interest(
      jsonb_build_object(
        'submission_key', 'db-test-rate-' || v_attempt::text,
        'first_name', 'Rate', 'last_name', 'Limit',
        'email', 'creator-interest-rate-limit@example.invalid', 'state', 'TX',
        'motivation', 'Verify bounded database abuse protection.',
        'participation', 'Rollback-only testing.',
        'relationship_types', jsonb_build_array('supporter'),
        'consent', true
      )
    );
  end loop;
end
$test$;

select pg_temp.assert_true(
  public.submit_website_creator_interest(
    jsonb_build_object(
      'submission_key', 'db-test-rate-1',
      'first_name', 'Rate', 'last_name', 'Limit',
      'email', 'creator-interest-rate-limit@example.invalid', 'state', 'TX',
      'motivation', 'Verify bounded database abuse protection.',
      'participation', 'Rollback-only testing.',
      'relationship_types', jsonb_build_array('supporter'), 'consent', true
    )
  ) = '{"ok": true}'::jsonb,
  'same-key replay was blocked by the distinct-submission rate limit'
);

select pg_temp.expect_unavailable(
  jsonb_build_object(
    'submission_key', 'db-test-rate-6',
    'first_name', 'Rate', 'last_name', 'Limit',
    'email', 'creator-interest-rate-limit@example.invalid', 'state', 'TX',
    'motivation', 'Sixth request.', 'participation', 'Rollback-only testing.',
    'relationship_types', jsonb_build_array('supporter'), 'consent', true
  ),
  'sixth distinct request inside one hour'
);

select pg_temp.assert_true(
  (
    select count(*) = 5
    from public.website_submissions
    where source_system = 'valorwell_website_interest'
      and submission_type = 'interest_submission'
      and lower(btrim(payload ->> 'email'))
        = 'creator-interest-rate-limit@example.invalid'
  ),
  'rate limiting did not retain exactly five distinct raw submissions'
);

-- Validation and all-or-nothing behavior.
select pg_temp.expect_invalid(
  jsonb_build_object(
    'submission_key', 'db-test-missing-required',
    'first_name', 'Missing', 'last_name', 'Required',
    'email', 'missing-required@example.invalid', 'state', 'TX',
    'participation', 'test',
    'relationship_types', jsonb_build_array('creator'), 'consent', true
  ),
  'missing required motivation'
);

select pg_temp.expect_invalid(
  jsonb_build_object(
    'submission_key', 'db-test-invalid-email',
    'first_name', 'Invalid', 'last_name', 'Email', 'email', 'not-an-email',
    'state', 'TX', 'motivation', 'test', 'participation', 'test',
    'relationship_types', jsonb_build_array('creator'), 'consent', true
  ),
  'invalid email'
);

do $test$
declare
  v_email text;
begin
  foreach v_email in array array[
    'a..b@example.com', '.a@example.com', 'a@-example.com'
  ]::text[] loop
    perform pg_temp.expect_invalid(
      jsonb_build_object(
        'submission_key', 'db-test-malformed-' || md5(v_email),
        'first_name', 'Malformed', 'last_name', 'Email', 'email', v_email,
        'state', 'TX', 'motivation', 'test', 'participation', 'test',
        'relationship_types', jsonb_build_array('creator'), 'consent', true
      ),
      'malformed email ' || v_email
    );
  end loop;
end
$test$;

select pg_temp.expect_invalid(
  jsonb_build_object(
    'submission_key', 'db-test-invalid-state',
    'first_name', 'Invalid', 'last_name', 'State',
    'email', 'invalid-state@example.invalid', 'state', 'ZZ',
    'motivation', 'test', 'participation', 'test',
    'relationship_types', jsonb_build_array('creator'), 'consent', true
  ),
  'unknown state code'
);

select pg_temp.expect_invalid(
  jsonb_build_object(
    'submission_key', 'db-test-no-consent',
    'first_name', 'Missing', 'last_name', 'Consent',
    'email', 'missing-consent@example.invalid', 'state', 'TX',
    'motivation', 'test', 'participation', 'test',
    'relationship_types', jsonb_build_array('creator'), 'consent', false
  ),
  'missing consent'
);

select pg_temp.expect_invalid(
  jsonb_build_object(
    'submission_key', 'db-test-unexpected-field',
    'first_name', 'Unexpected', 'last_name', 'Field',
    'email', 'unexpected-field@example.invalid', 'state', 'TX',
    'motivation', 'test', 'participation', 'test',
    'relationship_types', jsonb_build_array('creator'), 'consent', true,
    'password', 'must never be accepted'
  ),
  'unexpected field'
);

select pg_temp.expect_invalid(
  jsonb_build_object(
    'submission_key', 'db-test-oversized',
    'first_name', 'Oversized', 'last_name', 'Payload',
    'email', 'oversized@example.invalid', 'state', 'TX',
    'motivation', repeat('x', 33000), 'participation', 'test',
    'relationship_types', jsonb_build_array('creator'), 'consent', true
  ),
  'oversized payload'
);

select pg_temp.expect_invalid(
  jsonb_build_object(
    'submission_key', 'db-test-partial-failure',
    'first_name', 'Partial', 'last_name', 'Failure',
    'email', 'partial-failure@example.invalid', 'state', 'TX',
    'motivation', 'test', 'participation', 'test',
    'relationship_types', jsonb_build_array('creator'), 'consent', true,
    'social_profiles', jsonb_build_array(
      jsonb_build_object(
        'platform', 'reddit',
        'profile_url', 'javascript:alert(1)',
        'follower_count', 1
      )
    )
  ),
  'unsafe social URL'
);

select pg_temp.assert_true(
  not exists (
    select 1 from public.relationship_contacts
    where lower(email) = 'partial-failure@example.invalid'
  ) and not exists (
    select 1 from public.website_submissions
    where source_system = 'valorwell_website_interest'
      and source_record_key = 'request:db-test-partial-failure'
  ),
  'failed submission left partial rows behind'
);

-- Simulate a disagreeing explicit source mapping and normalized-email match.
-- The function must preserve raw history as reviewing without choosing a contact.
insert into public.relationship_contacts (
  tenant_id, email, veteran_affiliation, source, source_record_key
) values (
  (select id from public.tenants where slug = 'valorwell'),
  'creator-interest-mapping-source@example.invalid',
  'unknown',
  'valorwell_website_interest',
  'email:' || md5('creator-interest-conflict@example.invalid')
);

insert into public.relationship_contacts (
  tenant_id, email, veteran_affiliation, source, source_record_key
) values (
  (select id from public.tenants where slug = 'valorwell'),
  'creator-interest-conflict@example.invalid',
  'unknown',
  'database_verification',
  'conflict-email-match'
);

select pg_temp.assert_true(
  public.submit_website_creator_interest(jsonb_build_object(
    'submission_key', 'db-test-conflict-0004',
    'first_name', 'Conflict', 'last_name', 'Review',
    'email', 'creator-interest-conflict@example.invalid', 'state', 'TX',
    'motivation', 'Verify conflict routing.', 'participation', 'Staff review.',
    'relationship_types', jsonb_build_array('supporter'), 'consent', true
  )) = '{"ok": true, "needs_review": true}'::jsonb,
  'conflict response did not return the safe needs_review flag'
);

select pg_temp.assert_true(
  (
    select count(*) = 1
      and bool_and(status = 'reviewing')
      and bool_and(contact_id is null)
    from public.website_submissions
    where source_system = 'valorwell_website_interest'
      and source_record_key = 'request:db-test-conflict-0004'
  ),
  'conflicting contacts were not routed to raw reviewing history'
);

select pg_temp.assert_true(
  (
    select count(*) = 1
    from public.relationship_interest_submission_conflicts
    where source_record_key = 'request:db-test-conflict-0004'
  ),
  'the staff conflict feed did not expose the reviewing raw submission'
);

-- Use an existing staff/admin solely as an authorization principal. Changes are
-- limited to the rollback-only contact created above.
select set_config(
  'creator_interest_test.staff_id',
  (
    select roles.user_id::text
    from public.user_roles as roles
    join public.tenant_memberships as membership
      on membership.profile_id = roles.user_id
    join public.tenants as tenant on tenant.id = membership.tenant_id
    where roles.role in ('staff', 'admin')
      and tenant.slug = 'valorwell'
    order by roles.user_id
    limit 1
  ),
  true
);

select pg_temp.assert_true(
  nullif(current_setting('creator_interest_test.staff_id', true), '') is not null,
  'no tenant-member staff/admin principal was available for RLS verification'
);

insert into public.tenants (name, slug)
values ('Creator Interest Rollback Test', 'creator-interest-rollback-test');

insert into public.tenant_memberships (tenant_id, profile_id)
values (
  (select id from public.tenants where slug = 'creator-interest-rollback-test'),
  current_setting('creator_interest_test.other_staff_profile_id')::uuid
);

insert into public.relationship_contacts (
  tenant_id, email, veteran_affiliation, source, source_record_key
) values (
  (select id from public.tenants where slug = 'creator-interest-rollback-test'),
  'cross-tenant-contact@example.invalid',
  'unknown',
  'database_verification',
  'cross-tenant-contact'
);

insert into public.website_submissions (
  tenant_id,
  submission_type,
  original_lane,
  normalized_lane,
  source_system,
  source_record_key,
  payload,
  consent,
  status
) values (
  (select id from public.tenants where slug = 'creator-interest-rollback-test'),
  'interest_submission',
  'creator_promoter_community_interest',
  'partnership_support',
  'valorwell_website_interest',
  'request:db-test-other-tenant-conflict',
  '{"database_verification": true}'::jsonb,
  true,
  'reviewing'
);

-- The composite FK must reject a note whose tenant differs from its contact.
do $test$
declare
  v_denied boolean := false;
begin
  begin
    insert into public.crm_notes (
      tenant_id,
      relationship_contact_id,
      created_by_profile_id,
      note_content,
      note_type
    ) values (
      (select id from public.tenants where slug = 'valorwell'),
      (select id from public.relationship_contacts
       where source = 'database_verification'
         and source_record_key = 'cross-tenant-contact'),
      current_setting('creator_interest_test.staff_id')::uuid,
      'Must fail tenant/contact integrity.',
      'internal'
    );
  exception when foreign_key_violation then
    v_denied := true;
  end;

  if not v_denied then
    raise exception 'verification failed: cross-tenant relationship note was accepted';
  end if;
end
$test$;

select set_config(
  'request.jwt.claim.sub',
  current_setting('creator_interest_test.staff_id'),
  true
);
set local role authenticated;

do $test$
declare
  v_own_conflicts integer;
  v_other_conflicts integer;
begin
  select count(*) into v_own_conflicts
  from public.relationship_interest_submission_conflicts
  where source_record_key = 'request:db-test-conflict-0004';

  select count(*) into v_other_conflicts
  from public.relationship_interest_submission_conflicts
  where source_record_key = 'request:db-test-other-tenant-conflict';

  if v_own_conflicts <> 1 or v_other_conflicts <> 0 then
    raise exception 'verification failed: staff conflict feed tenant isolation failed';
  end if;
end
$test$;

select public.update_creator_interest_record(
  (select id from public.tenants where slug = 'valorwell'),
  (select id from public.relationship_contacts
   where lower(email) = 'creator-interest-db-test@example.invalid'),
  jsonb_build_object(
    'preferred_name', 'Atomic DB Test',
    'review_state', 'direct_outreach',
    'outreach_status', 'reviewing',
    'owner_profile_id', current_setting('creator_interest_test.staff_id'),
    'next_action', 'Complete rollback-only verification',
    'next_action_due_at', (now() + interval '1 day')::text
  ),
  jsonb_build_object(
    'motivation', 'Atomically corrected motivation.',
    'comfort_level', 'private_conversation',
    'personal_mission', 'Atomically corrected mission.'
  )
);

do $test$
declare
  v_cross_tenant_denied boolean := false;
  v_nonstaff_denied boolean := false;
begin
  begin
    perform public.update_creator_interest_record(
      (select id from public.tenants where slug = 'valorwell'),
      (select id from public.relationship_contacts
       where lower(email) = 'creator-interest-db-test@example.invalid'),
      jsonb_build_object('owner_profile_id', current_setting('creator_interest_test.other_staff_profile_id')),
      null
    );
  exception when sqlstate 'P0001' then
    v_cross_tenant_denied := true;
  end;

  begin
    perform public.update_creator_interest_record(
      (select id from public.tenants where slug = 'valorwell'),
      (select id from public.relationship_contacts
       where lower(email) = 'creator-interest-db-test@example.invalid'),
      jsonb_build_object('owner_profile_id', current_setting('creator_interest_test.client_profile_id')),
      null
    );
  exception when sqlstate 'P0001' then
    v_nonstaff_denied := true;
  end;

  if not v_cross_tenant_denied or not v_nonstaff_denied then
    raise exception 'verification failed: invalid relationship owner was accepted';
  end if;
end
$test$;

do $test$
declare
  v_failed boolean := false;
begin
  begin
    perform public.update_creator_interest_record(
      (select id from public.tenants where slug = 'creator-interest-rollback-test'),
      (select id from public.relationship_contacts
       where source = 'database_verification'
         and source_record_key = 'cross-tenant-contact'),
      '{"review_state":"managed"}'::jsonb,
      null
    );
  exception when sqlstate 'P0001' then
    v_failed := true;
  end;

  if not v_failed then
    raise exception 'verification failed: unauthorized tenant RPC update succeeded';
  end if;
end
$test$;

do $test$
declare
  v_failed boolean := false;
begin
  begin
    perform public.update_creator_interest_record(
      (select id from public.tenants where slug = 'valorwell'),
      (select id from public.relationship_contacts
       where lower(email) = 'creator-interest-db-test@example.invalid'),
      '{"preferred_name":"MUST ROLL BACK"}'::jsonb,
      '{"comfort_level":"not-a-valid-code"}'::jsonb
    );
  exception when sqlstate 'P0001' then
    v_failed := true;
  end;

  if not v_failed then
    raise exception 'verification failed: invalid atomic profile correction succeeded';
  end if;
end
$test$;

insert into public.crm_notes (
  tenant_id,
  relationship_contact_id,
  created_by_profile_id,
  note_content,
  note_type
) values (
  (select id from public.tenants where slug = 'valorwell'),
  (select id from public.relationship_contacts
   where lower(email) = 'creator-interest-db-test@example.invalid'),
  current_setting('creator_interest_test.staff_id')::uuid,
  'Rollback-only relationship interaction verification.',
  'internal'
);

do $test$
declare
  v_updated integer;
begin
  update public.relationship_contacts
  set review_state = 'managed'
  where source = 'database_verification'
    and source_record_key = 'cross-tenant-contact';
  get diagnostics v_updated = row_count;

  if v_updated <> 0 then
    raise exception 'verification failed: staff changed a non-member tenant row';
  end if;
end
$test$;

reset role;

do $test$
declare
  v_delete_denied boolean := false;
begin
  begin
    delete from public.relationship_contacts
    where lower(email) = 'creator-interest-db-test@example.invalid';
  exception when foreign_key_violation then
    v_delete_denied := true;
  end;
  if not v_delete_denied then
    raise exception 'verification failed: deleting a contact erased its interaction note';
  end if;
end
$test$;

insert into public.crm_notes (
  tenant_id, relationship_contact_id, created_by_profile_id, note_content, note_type
) values (
  (select id from public.tenants where slug = 'valorwell'),
  null,
  current_setting('creator_interest_test.staff_id')::uuid,
  'Legacy tenant-visible note fixture.',
  'internal'
);

select set_config(
  'request.jwt.claim.sub',
  current_setting('creator_interest_test.client_profile_id'),
  true
);
set local role authenticated;
do $test$
begin
  if (select count(*) from public.crm_notes where relationship_contact_id is not null) <> 0
     or (select count(*) from public.crm_notes
         where note_content = 'Legacy tenant-visible note fixture.') <> 1 then
    raise exception 'verification failed: client relationship-note isolation or legacy visibility failed';
  end if;
end
$test$;
reset role;

select pg_temp.assert_true(
  (
    select review_state = 'direct_outreach'
      and owner_profile_id = current_setting('creator_interest_test.staff_id')::uuid
      and preferred_name = 'Atomic DB Test'
      and outreach_status = 'reviewing'
      and next_action = 'Complete rollback-only verification'
      and next_action_due_at is not null
    from public.relationship_contacts
    where lower(email) = 'creator-interest-db-test@example.invalid'
  ),
  'authorized staff management update failed'
);

select pg_temp.assert_true(
  (
    select motivation = 'Atomically corrected motivation.'
      and comfort_level = 'private_conversation'
      and personal_mission = 'Atomically corrected mission.'
    from public.relationship_influencer_profiles
    where contact_id = (
      select id from public.relationship_contacts
      where lower(email) = 'creator-interest-db-test@example.invalid'
    )
  ),
  'atomic interest-profile correction failed'
);

select pg_temp.assert_true(
  (
    select preferred_name = 'Atomic DB Test'
    from public.relationship_contacts
    where lower(email) = 'creator-interest-db-test@example.invalid'
  ),
  'invalid profile correction did not roll back its contact changes'
);

select pg_temp.assert_true(
  (
    select count(*) = 1
    from public.crm_notes
    where relationship_contact_id = (
      select id from public.relationship_contacts
      where lower(email) = 'creator-interest-db-test@example.invalid'
    )
      and note_content = 'Rollback-only relationship interaction verification.'
  ),
  'authorized relationship interaction note failed'
);

select pg_temp.assert_true(
  (select count(*) from auth.users)
    = (select auth_user_count from creator_interest_test_baseline),
  'Auth users changed during creator-interest verification'
);

rollback;
