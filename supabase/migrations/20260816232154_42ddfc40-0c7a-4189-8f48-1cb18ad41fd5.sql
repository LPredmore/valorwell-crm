create table if not exists public.ai_operations_smoke_checks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  flow_key text not null,
  display_name text not null,
  domain text not null,
  criticality public.ai_ops_severity_enum not null default 'high',
  assertion_sql text not null,
  remediation text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, flow_key),
  constraint ai_operations_smoke_checks_readonly_sql check (
    assertion_sql ~* '^\s*select\s' and position(';' in assertion_sql) = 0
    and assertion_sql !~* '\y(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|do|call|vacuum|refresh)\y'
  )
);

create table if not exists public.ai_operations_smoke_results (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  run_id uuid not null references public.ai_operations_runs(id) on delete cascade,
  flow_key text not null,
  display_name text not null,
  domain text not null,
  status text not null check (status in ('healthy','failing','unknown','error')),
  broken_count integer not null default 0,
  source_count integer not null default 0,
  sample jsonb not null default '[]'::jsonb,
  error_message text,
  checked_at timestamptz not null default now(),
  unique (tenant_id, run_id, flow_key)
);

create index if not exists ai_operations_smoke_results_tenant_checked_idx
  on public.ai_operations_smoke_results (tenant_id, checked_at desc);

grant select on public.ai_operations_smoke_checks to authenticated;
grant all on public.ai_operations_smoke_checks to service_role;
grant select on public.ai_operations_smoke_results to authenticated;
grant all on public.ai_operations_smoke_results to service_role;

alter table public.ai_operations_smoke_checks enable row level security;
alter table public.ai_operations_smoke_results enable row level security;

create policy "AI Ops smoke checks are admin readable"
  on public.ai_operations_smoke_checks for select to authenticated
  using (private.ai_ops_is_admin_of(tenant_id));
create policy "AI Ops smoke checks are worker managed"
  on public.ai_operations_smoke_checks for all to service_role using (true) with check (true);
create policy "AI Ops smoke results are admin readable"
  on public.ai_operations_smoke_results for select to authenticated
  using (private.ai_ops_is_admin_of(tenant_id));
create policy "AI Ops smoke results are worker managed"
  on public.ai_operations_smoke_results for all to service_role using (true) with check (true);

insert into public.ai_operations_smoke_checks (tenant_id, flow_key, display_name, domain, criticality, assertion_sql, remediation)
values
('00000000-0000-0000-0000-000000000001','access.crm_capability_profile_exists','CRM access grants resolve to a real profile','access','critical',
 $$select count(*)::int as broken_count, (select count(*)::int from public.crm_user_capabilities c2 where c2.tenant_id = $2) as source_count,
   coalesce(jsonb_agg(jsonb_build_object('capabilityId', c.id, 'profileId', c.profile_id)) filter (where c.id is not null), '[]'::jsonb) as sample
   from public.crm_user_capabilities c
   where c.tenant_id = $2 and not exists (select 1 from public.profiles p where p.id = c.profile_id)$$,
 'Remove or repair CRM capability rows that point at a missing profile; affected staff cannot sign in to the CRM.'),

('00000000-0000-0000-0000-000000000001','intake.client_canonical_meta_present','New clients receive canonical journey state','client_intake','high',
 $$select count(*)::int as broken_count,
   (select count(*)::int from public.clients c2 where c2.tenant_id = $2 and c2.created_at >= $1 - interval '7 days') as source_count,
   coalesce(jsonb_agg(jsonb_build_object('clientId', c.id)) filter (where c.id is not null), '[]'::jsonb) as sample
   from public.clients c
   where c.tenant_id = $2 and c.created_at >= $1 - interval '7 days'
     and not exists (select 1 from public.crm_client_canonical_meta m where m.client_id = c.id and m.tenant_id = c.tenant_id)$$,
 'Backfill crm_client_canonical_meta for the affected clients; journey mutations fail without it.'),

('00000000-0000-0000-0000-000000000001','scheduling.appointment_shape_valid','Scheduled appointments are structurally valid','scheduling','high',
 $$select count(*)::int as broken_count,
   (select count(*)::int from public.appointments a2 where a2.tenant_id = $2 and a2.created_at >= $1 - interval '7 days') as source_count,
   coalesce(jsonb_agg(jsonb_build_object('appointmentId', a.id, 'startAt', a.start_at, 'endAt', a.end_at)) filter (where a.id is not null), '[]'::jsonb) as sample
   from public.appointments a
   where a.tenant_id = $2 and a.created_at >= $1 - interval '7 days'
     and (a.client_id is null or a.staff_id is null or a.start_at is null or a.end_at is null or a.end_at <= a.start_at)$$,
 'Correct the appointment record: every appointment needs a client, a clinician, and an end time after its start time.'),

('00000000-0000-0000-0000-000000000001','documentation.finalized_note_linked','Finalized clinical notes stay linked to their appointment','clinical_documentation','critical',
 $$select count(*)::int as broken_count,
   (select count(*)::int from public.appointment_clinical_notes n2 where n2.tenant_id = $2 and n2.finalized_at >= $1 - interval '7 days') as source_count,
   coalesce(jsonb_agg(jsonb_build_object('noteId', n.id, 'appointmentId', n.appointment_id)) filter (where n.id is not null), '[]'::jsonb) as sample
   from public.appointment_clinical_notes n
   where n.tenant_id = $2 and n.finalized_at >= $1 - interval '7 days'
     and (n.appointment_id is null or n.client_id is null
          or not exists (select 1 from public.appointments a where a.id = n.appointment_id))$$,
 'Relink the finalized note to its appointment; billing and payroll both read this link.'),

('00000000-0000-0000-0000-000000000001','billing.claim_has_service_lines','Submitted claims carry at least one service line','billing','high',
 $$select count(*)::int as broken_count,
   (select count(*)::int from public.claims c2 where c2.tenant_id = $2 and c2.created_at >= $1 - interval '7 days') as source_count,
   coalesce(jsonb_agg(jsonb_build_object('claimId', c.id, 'claimNumber', c.claim_number)) filter (where c.id is not null), '[]'::jsonb) as sample
   from public.claims c
   where c.tenant_id = $2 and c.created_at >= $1 - interval '7 days'
     and not exists (select 1 from public.claim_lines l where l.claim_id = c.id)$$,
 'Add the missing service lines or void the claim; line-less claims are rejected by the clearinghouse.'),

('00000000-0000-0000-0000-000000000001','campaigns.enrollment_references_valid','Campaign enrollments reference a live campaign and client','communications','high',
 $$select count(*)::int as broken_count,
   (select count(*)::int from public.crm_campaign_enrollments e2 where e2.tenant_id = $2 and e2.status = 'active') as source_count,
   coalesce(jsonb_agg(jsonb_build_object('enrollmentId', e.id, 'campaignId', e.campaign_id, 'clientId', e.client_id)) filter (where e.id is not null), '[]'::jsonb) as sample
   from public.crm_campaign_enrollments e
   where e.tenant_id = $2 and e.status = 'active'
     and (not exists (select 1 from public.crm_campaigns c where c.id = e.campaign_id)
          or not exists (select 1 from public.clients cl where cl.id = e.client_id))$$,
 'Cancel the orphaned enrollment; the scheduler cannot dispatch steps without a campaign and client.'),

('00000000-0000-0000-0000-000000000001','communications.newsletter_suppression_respected','Newsletters skip suppressed mailboxes','communications','critical',
 $$select count(*)::int as broken_count,
   (select count(*)::int from public.crm_newsletter_recipients r2 where r2.tenant_id = $2 and r2.sent_at >= $1 - interval '7 days') as source_count,
   coalesce(jsonb_agg(jsonb_build_object('recipientId', r.id, 'newsletterId', r.newsletter_id)) filter (where r.id is not null), '[]'::jsonb) as sample
   from public.crm_newsletter_recipients r
   where r.tenant_id = $2 and r.sent_at >= $1 - interval '7 days'
     and exists (select 1 from public.crm_newsletter_suppressions s
                 where s.tenant_id = r.tenant_id and s.mailbox_key = r.mailbox_key)$$,
 'Stop the send path that ignored the suppression list and confirm unsubscribe handling before the next newsletter.'),

('00000000-0000-0000-0000-000000000001','tasks.open_task_owner_valid','Open CRM tasks have a resolvable owner','tasks','medium',
 $$select count(*)::int as broken_count,
   (select count(*)::int from public.crm_tasks t2 where t2.tenant_id = $2 and t2.status in ('open','in_progress')) as source_count,
   coalesce(jsonb_agg(jsonb_build_object('taskId', t.id, 'ownerId', t.owner_id)) filter (where t.id is not null), '[]'::jsonb) as sample
   from public.crm_tasks t
   where t.tenant_id = $2 and t.status in ('open','in_progress')
     and t.owner_id is not null
     and not exists (select 1 from public.profiles p where p.id = t.owner_id)$$,
 'Reassign the task to an active staff profile; orphaned owners hide work from every task view.')
on conflict (tenant_id, flow_key) do nothing;

create or replace function public.ai_ops_evaluate_user_flow_smoke(
  p_tenant_id uuid, p_run_id uuid, p_cutoff_at timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_check record;
  v_broken int;
  v_source int;
  v_sample jsonb;
  v_status text;
  v_fingerprint text;
  v_observed text[] := '{}'::text[];
  v_results jsonb := '[]'::jsonb;
  v_healthy int := 0;
  v_failing int := 0;
  v_unknown int := 0;
  v_errored int := 0;
  v_error text;
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode = '42501';
  end if;

  for v_check in
    select * from public.ai_operations_smoke_checks
    where tenant_id = p_tenant_id and enabled
    order by flow_key
  loop
    v_error := null; v_broken := null; v_source := null; v_sample := '[]'::jsonb;
    begin
      execute format('select broken_count, source_count, sample from (%s) as smoke', v_check.assertion_sql)
        into v_broken, v_source, v_sample
        using p_cutoff_at, p_tenant_id;
    exception when others then
      v_error := left(sqlerrm, 500);
    end;

    if v_error is not null then
      v_status := 'error'; v_errored := v_errored + 1;
    elsif coalesce(v_source, 0) = 0 then
      v_status := 'unknown'; v_unknown := v_unknown + 1;
    elsif coalesce(v_broken, 0) > 0 then
      v_status := 'failing'; v_failing := v_failing + 1;
    else
      v_status := 'healthy'; v_healthy := v_healthy + 1;
    end if;

    insert into public.ai_operations_smoke_results (
      tenant_id, run_id, flow_key, display_name, domain, status,
      broken_count, source_count, sample, error_message, checked_at
    ) values (
      p_tenant_id, p_run_id, v_check.flow_key, v_check.display_name, v_check.domain, v_status,
      coalesce(v_broken, 0), coalesce(v_source, 0), coalesce(v_sample, '[]'::jsonb), v_error, now()
    )
    on conflict (tenant_id, run_id, flow_key) do update
      set status = excluded.status, broken_count = excluded.broken_count,
          source_count = excluded.source_count, sample = excluded.sample,
          error_message = excluded.error_message, checked_at = excluded.checked_at;

    v_results := v_results || jsonb_build_object(
      'flowKey', v_check.flow_key, 'displayName', v_check.display_name,
      'status', v_status, 'brokenCount', coalesce(v_broken, 0), 'sourceCount', coalesce(v_source, 0)
    );

    if v_status = 'failing' then
      v_fingerprint := 'smoke:' || v_check.flow_key || ':failing';
      v_observed := v_observed || v_fingerprint;
      perform public.ai_ops_upsert_finding(
        p_tenant_id, p_run_id, 'user_flow_smoke', v_fingerprint,
        format('%s is broken for %s record(s)', v_check.display_name, v_broken),
        v_check.criticality,
        format('Deterministic smoke check %s failed: %s of %s examined records violate the flow invariant.',
               v_check.flow_key, v_broken, v_source),
        v_check.remediation, 'smoke_flow', v_check.flow_key, null, null,
        jsonb_build_array(jsonb_build_object(
          'sourceType', 'smoke_check', 'sourceRecordId', v_check.flow_key,
          'sourceTimestamp', p_cutoff_at,
          'excerpt', left(coalesce(v_sample::text, ''), 900),
          'evidenceHash', md5(v_fingerprint || coalesce(v_sample::text, ''))
        ))
      );
    elsif v_status = 'error' then
      v_fingerprint := 'smoke:' || v_check.flow_key || ':error';
      v_observed := v_observed || v_fingerprint;
      perform public.ai_ops_upsert_finding(
        p_tenant_id, p_run_id, 'user_flow_smoke', v_fingerprint,
        format('%s could not be verified', v_check.display_name), 'high',
        format('UNKNOWN: the smoke check could not execute (%s). Flow health is unverified, not healthy.', v_error),
        'Repair the smoke check definition or the schema it depends on.',
        'smoke_flow', v_check.flow_key, null, null,
        jsonb_build_array(jsonb_build_object(
          'sourceType', 'smoke_check_error', 'sourceRecordId', v_check.flow_key,
          'sourceTimestamp', p_cutoff_at, 'excerpt', left(coalesce(v_error, ''), 900),
          'evidenceHash', md5(v_fingerprint || coalesce(v_error, ''))
        ))
      );
    end if;
  end loop;

  perform public.ai_ops_autoresolve_findings(p_tenant_id, 'user_flow_smoke', p_run_id, v_observed);

  return jsonb_build_object(
    'sourceAvailable', true, 'results', v_results,
    'healthy', v_healthy, 'failing', v_failing, 'unknown', v_unknown, 'errored', v_errored,
    'sourceItemsTotal', v_healthy + v_failing + v_unknown + v_errored,
    'itemsQueued', 0, 'batchesQueued', 0, 'cutoffAt', p_cutoff_at
  );
end;
$function$;

revoke all on function public.ai_ops_evaluate_user_flow_smoke(uuid, uuid, timestamptz) from public;
grant execute on function public.ai_ops_evaluate_user_flow_smoke(uuid, uuid, timestamptz) to service_role;