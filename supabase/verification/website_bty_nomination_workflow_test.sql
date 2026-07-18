-- Rollback-safe verification for 20260718112222_website_bty_nomination_intake.sql.
-- Run with a privileged SQL session after the migration is applied.

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

create or replace function pg_temp.nomination_payload(
  p_key text,
  p_email text,
  p_nomination_type text default 'individual',
  p_subject_name text default 'Helpful Person',
  p_subject_link text default null
)
returns jsonb
language sql
immutable
as $test$
  select jsonb_build_object(
    'submission_key', p_key,
    'nomination_type', p_nomination_type,
    'subject_name', p_subject_name,
    'subject_link', p_subject_link,
    'subject_veteran_affiliated', false,
    'first_name', 'Test',
    'last_name', 'Nominator',
    'email', p_email,
    'phone', '555-0100',
    'role_title', null,
    'action', 'They consistently organize useful community support.',
    'consent', true,
    'source_page', '/beyondtheyellow',
    'user_agent', 'database-verification'
  )
$test$;

create or replace function pg_temp.expect_invalid(p_payload jsonb, p_case text)
returns void
language plpgsql
as $test$
begin
  begin
    perform public.submit_website_bty_nomination(p_payload);
    raise exception 'verification failed: % was accepted', p_case;
  exception
    when sqlstate '22023' then
      if sqlerrm <> 'Invalid nomination.' then
        raise exception 'verification failed: % leaked validation detail: %', p_case, sqlerrm;
      end if;
  end;
end
$test$;

create or replace function pg_temp.expect_unavailable(p_payload jsonb, p_case text)
returns void
language plpgsql
as $test$
begin
  begin
    perform public.submit_website_bty_nomination(p_payload);
    raise exception 'verification failed: % was accepted', p_case;
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'Unable to submit nomination right now.' then
        raise exception 'verification failed: % leaked backend detail: %', p_case, sqlerrm;
      end if;
  end;
end
$test$;

create temporary table bty_nomination_baseline (
  auth_user_count bigint not null,
  profile_count bigint not null
) on commit drop;

insert into bty_nomination_baseline (auth_user_count, profile_count)
select (select count(*) from auth.users), (select count(*) from public.profiles);

select pg_temp.assert_true(
  has_function_privilege('anon', 'public.submit_website_bty_nomination(jsonb)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.submit_website_bty_nomination(jsonb)', 'EXECUTE')
    and not has_function_privilege('service_role', 'public.submit_website_bty_nomination(jsonb)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.website_intake_tenant_id()', 'EXECUTE'),
  'wrapper/helper execute privileges are broader than intended'
);

select pg_temp.assert_true(
  not has_table_privilege('anon', 'public.relationship_contacts', 'SELECT')
    and not has_table_privilege('anon', 'public.relationship_contacts', 'INSERT')
    and not has_table_privilege('anon', 'public.relationship_organizations', 'SELECT')
    and not has_table_privilege('anon', 'public.relationship_organizations', 'INSERT')
    and not has_table_privilege('anon', 'public.relationship_contact_roles', 'SELECT')
    and not has_table_privilege('anon', 'public.relationship_contact_roles', 'INSERT')
    and not has_table_privilege('anon', 'public.relationship_organization_roles', 'SELECT')
    and not has_table_privilege('anon', 'public.relationship_organization_roles', 'INSERT')
    and not has_table_privilege('anon', 'public.website_submissions', 'SELECT')
    and not has_table_privilege('anon', 'public.website_submissions', 'INSERT'),
  'migration changed anonymous direct-table access'
);

-- Tenant-one staff can manage tenant-one organizations, but cannot see or
-- reference tenant-two relationship subjects.
insert into public.relationship_organization_roles (
  tenant_id, organization_id, role_code, source
)
values (
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000301',
  'bty_nominee',
  'fixture'
);

select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000102',
  true
);
set local role authenticated;

select pg_temp.assert_true(
  (select count(*) = 0 from public.relationship_organizations
   where tenant_id = '00000000-0000-0000-0000-000000000002')
  and
  (select count(*) = 0 from public.relationship_organization_roles
   where tenant_id = '00000000-0000-0000-0000-000000000002'),
  'tenant-one staff can read tenant-two organization data'
);

insert into public.relationship_organizations (
  id, tenant_id, name, owner_profile_id, source, source_record_key
)
values (
  '00000000-0000-0000-0000-000000000302',
  '00000000-0000-0000-0000-000000000001',
  'Tenant One Staff Organization',
  '00000000-0000-0000-0000-000000000102',
  'staff-verification',
  'tenant-one-staff-organization'
);

update public.relationship_organizations
set owner_profile_id = null
where id = '00000000-0000-0000-0000-000000000302';

update public.relationship_organizations
set owner_profile_id = '00000000-0000-0000-0000-000000000102'
where id = '00000000-0000-0000-0000-000000000302';

insert into public.relationship_organization_roles (
  tenant_id, organization_id, role_code, source
)
values (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000302',
  'bty_nominee',
  'staff-verification'
);

insert into public.website_submissions (
  tenant_id, submission_type, original_lane, normalized_lane,
  contact_id, subject_organization_id, source_system, source_record_key,
  payload, consent, status
)
values (
  '00000000-0000-0000-0000-000000000001',
  'bty_submission',
  'nominate',
  'bty_participation',
  '00000000-0000-0000-0000-000000000201',
  '00000000-0000-0000-0000-000000000302',
  'staff-verification',
  'same-tenant-subject',
  '{}'::jsonb,
  true,
  'new'
);

do $test$
declare
  v_cross_org_denied boolean := false;
  v_cross_role_denied boolean := false;
  v_cross_subject_org_denied boolean := false;
  v_cross_subject_contact_denied boolean := false;
  v_cross_owner_insert_denied boolean := false;
  v_nonstaff_owner_insert_denied boolean := false;
  v_inactive_owner_insert_denied boolean := false;
  v_cross_owner_update_denied boolean := false;
  v_nonstaff_owner_update_denied boolean := false;
  v_inactive_owner_update_denied boolean := false;
begin
  begin
    insert into public.relationship_organizations (
      tenant_id, name, source, source_record_key
    ) values (
      '00000000-0000-0000-0000-000000000002',
      'Must Be Denied',
      'staff-verification',
      'cross-tenant-org-denied'
    );
  exception when insufficient_privilege then
    v_cross_org_denied := true;
  end;

  begin
    insert into public.relationship_organization_roles (
      tenant_id, organization_id, role_code, source
    ) values (
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000301',
      'bty_nominee',
      'staff-verification'
    );
  exception when insufficient_privilege then
    v_cross_role_denied := true;
  end;

  begin
    insert into public.website_submissions (
      tenant_id, submission_type, original_lane, normalized_lane,
      subject_organization_id, source_system, source_record_key, payload, consent
    ) values (
      '00000000-0000-0000-0000-000000000001',
      'bty_submission',
      'nominate',
      'bty_participation',
      '00000000-0000-0000-0000-000000000301',
      'staff-verification',
      'cross-subject-org-denied',
      '{}'::jsonb,
      true
    );
  exception when insufficient_privilege then
    v_cross_subject_org_denied := true;
  end;

  begin
    insert into public.website_submissions (
      tenant_id, submission_type, original_lane, normalized_lane,
      subject_contact_id, source_system, source_record_key, payload, consent
    ) values (
      '00000000-0000-0000-0000-000000000001',
      'bty_submission',
      'nominate',
      'bty_participation',
      '00000000-0000-0000-0000-000000000203',
      'staff-verification',
      'cross-subject-contact-denied',
      '{}'::jsonb,
      true
    );
  exception when insufficient_privilege then
    v_cross_subject_contact_denied := true;
  end;

  begin
    insert into public.relationship_organizations (
      tenant_id, name, owner_profile_id, source, source_record_key
    ) values (
      '00000000-0000-0000-0000-000000000001',
      'Cross Tenant Owner Must Be Denied',
      '00000000-0000-0000-0000-000000000103',
      'staff-verification',
      'cross-tenant-owner-insert-denied'
    );
  exception when insufficient_privilege then
    v_cross_owner_insert_denied := true;
  end;

  begin
    insert into public.relationship_organizations (
      tenant_id, name, owner_profile_id, source, source_record_key
    ) values (
      '00000000-0000-0000-0000-000000000001',
      'Nonstaff Owner Must Be Denied',
      '00000000-0000-0000-0000-000000000104',
      'staff-verification',
      'nonstaff-owner-insert-denied'
    );
  exception when insufficient_privilege then
    v_nonstaff_owner_insert_denied := true;
  end;

  begin
    insert into public.relationship_organizations (
      tenant_id, name, owner_profile_id, source, source_record_key
    ) values (
      '00000000-0000-0000-0000-000000000001',
      'Inactive Owner Must Be Denied',
      '00000000-0000-0000-0000-000000000105',
      'staff-verification',
      'inactive-owner-insert-denied'
    );
  exception when insufficient_privilege then
    v_inactive_owner_insert_denied := true;
  end;

  begin
    update public.relationship_organizations
    set owner_profile_id = '00000000-0000-0000-0000-000000000103'
    where id = '00000000-0000-0000-0000-000000000302';
  exception when insufficient_privilege then
    v_cross_owner_update_denied := true;
  end;

  begin
    update public.relationship_organizations
    set owner_profile_id = '00000000-0000-0000-0000-000000000104'
    where id = '00000000-0000-0000-0000-000000000302';
  exception when insufficient_privilege then
    v_nonstaff_owner_update_denied := true;
  end;

  begin
    update public.relationship_organizations
    set owner_profile_id = '00000000-0000-0000-0000-000000000105'
    where id = '00000000-0000-0000-0000-000000000302';
  exception when insufficient_privilege then
    v_inactive_owner_update_denied := true;
  end;

  if not v_cross_org_denied
     or not v_cross_role_denied
     or not v_cross_subject_org_denied
     or not v_cross_subject_contact_denied
     or not v_cross_owner_insert_denied
     or not v_nonstaff_owner_insert_denied
     or not v_inactive_owner_insert_denied
     or not v_cross_owner_update_denied
     or not v_nonstaff_owner_update_denied
     or not v_inactive_owner_update_denied then
    raise exception 'verification failed: tenant-scoped relationship write was accepted';
  end if;
end
$test$;

select pg_temp.assert_true(
  (
    select owner_profile_id = '00000000-0000-0000-0000-000000000102'::uuid
    from public.relationship_organizations
    where id = '00000000-0000-0000-0000-000000000302'
  ),
  'valid same-tenant active staff owner was not preserved after rejected writes'
);

reset role;

set local role anon;

select pg_temp.assert_true(
  public.submit_website_bty_nomination(
    pg_temp.nomination_payload(
      'nomination-db-0001',
      'rate-limit@example.invalid',
      'individual',
      'Helpful Person',
      'https://example.invalid/helpful-person'
    )
  ) = '{"ok":true}'::jsonb,
  'anonymous individual nomination did not return the safe success contract'
);

do $test$
declare
  v_denied boolean := false;
begin
  begin
    perform count(*) from public.website_submissions;
  exception when insufficient_privilege then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'verification failed: anon can read raw submissions directly';
  end if;
end
$test$;

reset role;

select pg_temp.assert_true(
  (
    select submission_type = 'bty_submission'
      and original_lane = 'nominate'
      and normalized_lane = 'bty_participation'
      and source_system = 'valorwell_website_bty_nomination'
      and source_record_key = 'request:nomination-db-0001'
      and consent
      and source_page = '/beyondtheyellow'
      and status = 'new'
      and contact_id is not null
      and subject_contact_id is not null
      and subject_organization_id is null
      and payload = pg_temp.nomination_payload(
        'nomination-db-0001',
        'rate-limit@example.invalid',
        'individual',
        'Helpful Person',
        'https://example.invalid/helpful-person'
      )
    from public.website_submissions
    where source_system = 'valorwell_website_bty_nomination'
      and source_record_key = 'request:nomination-db-0001'
  ),
  'individual raw submission fields/history were not preserved exactly'
);

select pg_temp.assert_true(
  (
    select count(*) = 1
    from public.relationship_contact_roles as role_assignment
    join public.website_submissions as submission
      on submission.subject_contact_id = role_assignment.contact_id
    where submission.source_record_key = 'request:nomination-db-0001'
      and role_assignment.role_code = 'bty_nominee'
      and role_assignment.source = 'valorwell_website_bty_nomination'
  ) and (
    select count(*) = 0
    from public.relationship_contact_roles as role_assignment
    join public.website_submissions as submission
      on submission.contact_id = role_assignment.contact_id
    where submission.source_record_key = 'request:nomination-db-0001'
  ),
  'bty_nominee was not assigned only to the individual nominee'
);

-- Exact replay succeeds without adding raw or canonical rows.
create temporary table replay_counts as
select
  (select count(*) from public.website_submissions) as submissions,
  (select count(*) from public.relationship_contacts) as contacts,
  (select count(*) from public.relationship_contact_roles) as roles;

select pg_temp.assert_true(
  public.submit_website_bty_nomination(
    pg_temp.nomination_payload(
      'nomination-db-0001',
      'rate-limit@example.invalid',
      'individual',
      'Helpful Person',
      'https://example.invalid/helpful-person'
    )
  ) = '{"ok":true}'::jsonb,
  'exact idempotent replay failed'
);

select pg_temp.assert_true(
  (select submissions from replay_counts) = (select count(*) from public.website_submissions)
    and (select contacts from replay_counts) = (select count(*) from public.relationship_contacts)
    and (select roles from replay_counts) = (select count(*) from public.relationship_contact_roles),
  'idempotent replay added duplicate rows'
);

select pg_temp.expect_unavailable(
  pg_temp.nomination_payload(
    'nomination-db-0001',
    'rate-limit@example.invalid',
    'individual',
    'Changed Subject',
    'https://example.invalid/helpful-person'
  ),
  'submission-key payload mismatch'
);

-- Five distinct nominations in one hour are accepted; the sixth is rejected.
select public.submit_website_bty_nomination(
  pg_temp.nomination_payload('nomination-db-0002', 'RATE-LIMIT@example.invalid')
);
select public.submit_website_bty_nomination(
  pg_temp.nomination_payload('nomination-db-0003', 'rate-limit@example.invalid')
);
select public.submit_website_bty_nomination(
  pg_temp.nomination_payload('nomination-db-0004', 'rate-limit@example.invalid')
);
select public.submit_website_bty_nomination(
  pg_temp.nomination_payload('nomination-db-0005', 'rate-limit@example.invalid')
);

select pg_temp.assert_true(
  (
    select count(*) = 5
    from public.website_submissions
    where source_system = 'valorwell_website_bty_nomination'
      and lower(btrim(payload ->> 'email')) = 'rate-limit@example.invalid'
  ),
  'five distinct accepted nominations were not preserved'
);

select pg_temp.expect_unavailable(
  pg_temp.nomination_payload('nomination-db-0006', 'rate-limit@example.invalid'),
  'sixth distinct nomination in one hour'
);

-- Organization nominees use the organization role table; the nominator has no role.
select public.submit_website_bty_nomination(
  pg_temp.nomination_payload(
    'nomination-org-0001',
    'organization-nominator@example.invalid',
    'organization',
    'Helpful Organization',
    'https://helpful.example.invalid'
  ) || jsonb_build_object('role_title', 'Director')
);

select pg_temp.assert_true(
  (
    select subject_contact_id is null
      and subject_organization_id is not null
      and contact_id is not null
    from public.website_submissions
    where source_record_key = 'request:nomination-org-0001'
  ) and (
    select count(*) = 1
    from public.relationship_organization_roles as role_assignment
    join public.website_submissions as submission
      on submission.subject_organization_id = role_assignment.organization_id
    where submission.source_record_key = 'request:nomination-org-0001'
      and role_assignment.role_code = 'bty_nominee'
  ) and (
    select count(*) = 0
    from public.relationship_contact_roles as role_assignment
    join public.website_submissions as submission
      on submission.contact_id = role_assignment.contact_id
    where submission.source_record_key = 'request:nomination-org-0001'
  ) and (
    select organization.veteran_affiliated is null
    from public.relationship_organizations as organization
    join public.website_submissions as submission
      on submission.subject_organization_id = organization.id
    where submission.source_record_key = 'request:nomination-org-0001'
  ),
  'organization nominee role/linkage was not isolated from the nominator'
);

select public.submit_website_bty_nomination(
  pg_temp.nomination_payload(
    'nomination-org-0002',
    'organization-nominator@example.invalid',
    'organization',
    'Helpful Organization',
    'https://helpful.example.invalid'
  ) || jsonb_build_object('subject_veteran_affiliated', true)
);

select pg_temp.assert_true(
  (
    select count(*) = 1 and bool_and(organization.veteran_affiliated is true)
    from public.relationship_organizations as organization
    where organization.source = 'valorwell_website_bty_nomination'
      and organization.source_record_key = 'subject:organization:link:'
        || md5('https://helpful.example.invalid')
  ) and (
    select count(*) = 2
    from public.website_submissions
    where source_record_key in (
      'request:nomination-org-0001',
      'request:nomination-org-0002'
    )
  ),
  'repeat same-link affirmative nomination did not promote unknown veteran affiliation'
);

update public.relationship_organizations
set veteran_affiliated = false
where source = 'valorwell_website_bty_nomination'
  and source_record_key = 'subject:organization:link:'
    || md5('https://helpful.example.invalid');

select public.submit_website_bty_nomination(
  pg_temp.nomination_payload(
    'nomination-org-0003',
    'organization-nominator@example.invalid',
    'organization',
    'Helpful Organization',
    'https://helpful.example.invalid'
  ) || jsonb_build_object('subject_veteran_affiliated', true)
);

select pg_temp.assert_true(
  (
    select count(*) = 1 and bool_and(organization.veteran_affiliated is false)
    from public.relationship_organizations as organization
    where organization.source = 'valorwell_website_bty_nomination'
      and organization.source_record_key = 'subject:organization:link:'
        || md5('https://helpful.example.invalid')
  ) and (
    select count(*) = 3
    from public.website_submissions
    where source_record_key in (
      'request:nomination-org-0001',
      'request:nomination-org-0002',
      'request:nomination-org-0003'
    )
  ),
  'anonymous affirmative nomination overwrote an evidence-backed false correction'
);

-- Profile-linked established contacts may be linked to raw history but are immutable.
select public.submit_website_bty_nomination(
  pg_temp.nomination_payload(
    'nomination-established-0001',
    'ESTABLISHED@example.invalid'
  ) || jsonb_build_object(
    'first_name', 'Anonymous Rewrite',
    'last_name', 'Attempt',
    'phone', '555-9999'
  )
);

select pg_temp.assert_true(
  (
    select profile_id = '00000000-0000-0000-0000-000000000101'::uuid
      and first_name = 'Established'
      and last_name = 'Identity'
      and phone = '555-0001'
      and source = 'therapist_crm_clinician_application'
      and source_record_key = 'established-identity'
      and metadata = '{"protected":true}'::jsonb
    from public.relationship_contacts
    where id = '00000000-0000-0000-0000-000000000201'
  ) and (
    select contact_id = '00000000-0000-0000-0000-000000000201'::uuid
    from public.website_submissions
    where source_record_key = 'request:nomination-established-0001'
  ),
  'public nomination mutated a profile-linked established identity'
);

-- Identity-free contacts from an approved migration source may receive blanks only.
select public.submit_website_bty_nomination(
  pg_temp.nomination_payload('nomination-merge-0001', 'MERGE@example.invalid')
  || jsonb_build_object('first_name', 'Filled', 'last_name', 'Blanks', 'phone', '555-0200')
);

select pg_temp.assert_true(
  (
    select profile_id is null
      and first_name = 'Filled'
      and last_name = 'Blanks'
      and phone = '555-0200'
      and source = 'therapist_crm_interest_migration'
      and source_record_key = 'historical-merge'
    from public.relationship_contacts
    where id = '00000000-0000-0000-0000-000000000202'
  ),
  'approved identity-free migration contact did not receive blank-field enrichment'
);

-- A disagreeing explicit source mapping is retained as raw review history only.
insert into public.relationship_contacts (
  tenant_id, email, source, source_record_key
)
values
  (
    '00000000-0000-0000-0000-000000000001',
    'source-mapping-other@example.invalid',
    'valorwell_website_bty_nomination',
    'email:' || md5('conflict@example.invalid')
  ),
  (
    '00000000-0000-0000-0000-000000000001',
    'conflict@example.invalid',
    'therapist_crm_interest_migration',
    'conflict-email-contact'
  );

select public.submit_website_bty_nomination(
  pg_temp.nomination_payload('nomination-conflict-0001', 'conflict@example.invalid')
);

select pg_temp.assert_true(
  (
    select status = 'reviewing'
      and contact_id is null
      and subject_contact_id is null
      and subject_organization_id is null
    from public.website_submissions
    where source_record_key = 'request:nomination-conflict-0001'
  ) and not exists (
    select 1
    from public.relationship_contacts
    where source_record_key = 'subject:individual:request:nomination-conflict-0001'
  ),
  'ambiguous nominator match was guessed instead of preserved for review'
);

-- Authenticated callers have only the same wrapper contract.
set local role authenticated;
select pg_temp.assert_true(
  public.submit_website_bty_nomination(
    pg_temp.nomination_payload('nomination-auth-0001', 'authenticated@example.invalid')
  ) = '{"ok":true}'::jsonb,
  'authenticated wrapper execution failed'
);
reset role;

-- Strict object, whitelist, type, size, email, URL, length, and consent checks.
select pg_temp.expect_invalid(null, 'null payload');
select pg_temp.expect_invalid('[]'::jsonb, 'non-object payload');
select pg_temp.expect_invalid(
  pg_temp.nomination_payload('nomination-invalid-0001', 'valid@example.invalid')
    || '{"profile_id":"00000000-0000-0000-0000-000000000101"}'::jsonb,
  'unexpected internal identifier'
);
select pg_temp.expect_invalid(
  pg_temp.nomination_payload('nomination-invalid-0002', 'missing-tld@example'),
  'email without ASCII TLD'
);
select pg_temp.expect_invalid(
  pg_temp.nomination_payload('nomination-invalid-0003', 'valid@example.invalid')
    || '{"subject_link":"http://example.invalid"}'::jsonb,
  'non-HTTPS subject link'
);
select pg_temp.expect_invalid(
  pg_temp.nomination_payload('nomination-invalid-0004', 'valid@example.invalid')
    || '{"consent":false}'::jsonb,
  'false consent'
);
select pg_temp.expect_invalid(
  pg_temp.nomination_payload('nomination-invalid-0005', 'valid@example.invalid')
    || '{"subject_veteran_affiliated":"false"}'::jsonb,
  'wrong boolean type'
);
select pg_temp.expect_invalid(
  pg_temp.nomination_payload('nomination-invalid-0006', 'valid@example.invalid')
    || jsonb_build_object('action', repeat('x', 17000)),
  'oversized server payload'
);

select pg_temp.assert_true(
  (select count(*) from auth.users) = (select auth_user_count from bty_nomination_baseline)
    and (select count(*) from public.profiles) = (select profile_count from bty_nomination_baseline)
    and not exists (
      select 1
      from public.relationship_contacts
      where source = 'valorwell_website_bty_nomination'
        and profile_id is not null
    ),
  'nomination workflow created Auth/profile rows or set profile_id'
);

select pg_temp.assert_true(
  not exists (
    select 1
    from public.relationship_contact_roles
    where role_code <> 'bty_nominee'
  ) and not exists (
    select 1
    from public.relationship_organization_roles
    where role_code <> 'bty_nominee'
  ),
  'nomination workflow accepted an arbitrary role'
);

rollback;
