-- Phase 6: ValorWell Daily Command Center (aggregation layer over existing AI Operations findings)

alter type public.ai_ops_finding_status_enum add value if not exists 'reviewed';
alter type public.ai_ops_finding_status_enum add value if not exists 'assigned';
alter type public.ai_ops_finding_status_enum add value if not exists 'in_progress';

alter table public.ai_operations_findings
  add column if not exists assigned_to_profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists assigned_at timestamptz,
  add column if not exists reviewed_at timestamptz,
  add column if not exists occurrence_count integer not null default 1,
  add column if not exists last_occurrence_date date;

create index if not exists ai_operations_findings_assignee_idx
  on public.ai_operations_findings (tenant_id, assigned_to_profile_id)
  where assigned_to_profile_id is not null;

-- Deterministic management category. Organisational label only; no findings are created here.
create or replace function private.ai_ops_finding_category(p_module public.ai_ops_module_enum)
returns text
language sql
immutable
set search_path to ''
as $$
  select case p_module
    when 'client_journey' then 'client_care'
    when 'staff_quality' then 'staff'
    when 'appointment_integrity' then 'appointments'
    when 'billing_claims' then 'billing'
    when 'communications' then 'communications'
    when 'relationship_followup' then 'relationships'
    when 'donor_intelligence' then 'donors_growth'
    when 'bty_intelligence' then 'beyond_the_yellow'
    when 'social_leads' then 'marketing_content'
    when 'content_opportunities' then 'marketing_content'
    when 'content_performance' then 'marketing_content'
    when 'data_quality' then 'data_quality'
    when 'sop_compliance' then 'compliance_sop'
    else 'system_health'
  end
$$;

grant execute on function private.ai_ops_finding_category(public.ai_ops_module_enum) to service_role;

-- Occurrence tracking + severity-increase history, so recurring problems update one finding.
create or replace function public.ai_ops_upsert_finding(
  p_tenant_id uuid,
  p_run_id uuid,
  p_module public.ai_ops_module_enum,
  p_fingerprint text,
  p_title text,
  p_severity public.ai_ops_severity_enum,
  p_summary text default null,
  p_recommended_action text default null,
  p_entity_type text default null,
  p_entity_id text default null,
  p_confidence numeric default null,
  p_related_existing_exception_id uuid default null,
  p_evidence jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_existing public.ai_operations_findings;
  v_finding_id uuid;
  v_reopened boolean := false;
  v_business_date date;
  v_new_occurrence boolean := false;
  v_severity_increased boolean := false;
  v_rank_new integer;
  v_rank_old integer;
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode = '42501';
  end if;

  select r.business_date into v_business_date
  from public.ai_operations_runs r where r.id = p_run_id;

  select * into v_existing from public.ai_operations_findings
  where tenant_id = p_tenant_id and module = p_module and fingerprint = p_fingerprint
  for update;

  if v_existing.id is null then
    insert into public.ai_operations_findings (
      tenant_id, module, fingerprint, entity_type, entity_id, title, summary, severity,
      confidence, recommended_action, status, last_run_id, related_existing_exception_id,
      occurrence_count, last_occurrence_date
    ) values (
      p_tenant_id, p_module, p_fingerprint, p_entity_type, p_entity_id, p_title, p_summary, p_severity,
      p_confidence, p_recommended_action, 'open', p_run_id, p_related_existing_exception_id,
      1, v_business_date
    )
    returning id into v_finding_id;

    insert into public.ai_operations_finding_events (finding_id, tenant_id, event_type, actor_kind, new_value)
    values (v_finding_id, p_tenant_id, 'detected', 'system',
            jsonb_build_object('severity', p_severity, 'runId', p_run_id, 'evidence', coalesce(p_evidence, '[]'::jsonb)));
  else
    v_finding_id := v_existing.id;
    v_reopened := v_existing.status in ('resolved','dismissed')
      or (v_existing.status = 'snoozed' and coalesce(v_existing.snoozed_until, now()) <= now())
      or (v_existing.status = 'snoozed' and p_severity = 'critical');

    v_new_occurrence := v_business_date is not null
      and (v_existing.last_occurrence_date is null or v_existing.last_occurrence_date <> v_business_date);

    v_rank_new := case p_severity when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end;
    v_rank_old := case v_existing.severity when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end;
    v_severity_increased := v_rank_new < v_rank_old;

    update public.ai_operations_findings
       set title = p_title,
           summary = coalesce(p_summary, summary),
           severity = p_severity,
           confidence = coalesce(p_confidence, confidence),
           recommended_action = coalesce(p_recommended_action, recommended_action),
           entity_type = coalesce(p_entity_type, entity_type),
           entity_id = coalesce(p_entity_id, entity_id),
           related_existing_exception_id = coalesce(p_related_existing_exception_id, related_existing_exception_id),
           last_seen_at = now(),
           last_run_id = p_run_id,
           occurrence_count = occurrence_count + case when v_new_occurrence then 1 else 0 end,
           last_occurrence_date = coalesce(v_business_date, last_occurrence_date),
           status = case when v_reopened then 'open'::public.ai_ops_finding_status_enum else status end,
           resolved_at = case when v_reopened then null else resolved_at end,
           dismissed_at = case when v_reopened then null else dismissed_at end,
           snoozed_until = case when v_reopened then null else snoozed_until end,
           reopen_count = reopen_count + case when v_reopened then 1 else 0 end,
           updated_at = now()
     where id = v_finding_id;

    if v_reopened then
      insert into public.ai_operations_finding_events (finding_id, tenant_id, event_type, actor_kind, previous_value, new_value)
      values (v_finding_id, p_tenant_id, 'reopened', 'system',
              jsonb_build_object('status', v_existing.status),
              jsonb_build_object('status', 'open', 'runId', p_run_id));
    end if;

    if v_severity_increased then
      insert into public.ai_operations_finding_events (finding_id, tenant_id, event_type, actor_kind, previous_value, new_value)
      values (v_finding_id, p_tenant_id, 'severity_increased', 'system',
              jsonb_build_object('severity', v_existing.severity),
              jsonb_build_object('severity', p_severity, 'runId', p_run_id));
    end if;

    insert into public.ai_operations_finding_events (finding_id, tenant_id, event_type, actor_kind, new_value)
    values (v_finding_id, p_tenant_id, 'observed', 'system',
            jsonb_build_object('severity', p_severity, 'runId', p_run_id, 'evidence', coalesce(p_evidence, '[]'::jsonb)));
  end if;

  return jsonb_build_object('findingId', v_finding_id, 'reopened', v_reopened);
end;
$function$;

-- Extended lifecycle transitions (review / assign / start work) with full history.
drop function if exists private.ai_ops_transition_finding(uuid, text, text, timestamptz);

create or replace function private.ai_ops_transition_finding(
  p_finding_id uuid,
  p_action text,
  p_reason text,
  p_snooze_until timestamptz default null,
  p_assignee uuid default null
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_context jsonb := private.ai_ops_context(true);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
  v_actor uuid := (v_context->>'actor_id')::uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_finding public.ai_operations_findings;
  v_new_status public.ai_ops_finding_status_enum;
  v_assignee uuid := p_assignee;
begin
  if v_reason is null then
    raise exception 'A reason is required to change an AI Operations finding.' using errcode = '22023';
  end if;

  select * into v_finding from public.ai_operations_findings
  where id = p_finding_id and tenant_id = v_tenant
  for update;

  if v_finding.id is null then
    raise exception 'Finding not found.' using errcode = 'P0002';
  end if;

  v_new_status := case p_action
    when 'resolve' then 'resolved'
    when 'dismiss' then 'dismissed'
    when 'snooze' then 'snoozed'
    when 'reopen' then 'open'
    when 'review' then 'reviewed'
    when 'assign' then 'assigned'
    when 'start' then 'in_progress'
    else null
  end::public.ai_ops_finding_status_enum;

  if v_new_status is null then
    raise exception 'Unknown finding action: %', p_action using errcode = '22023';
  end if;

  if p_action = 'snooze' and (p_snooze_until is null or p_snooze_until <= now()) then
    raise exception 'A future snooze date is required.' using errcode = '22023';
  end if;

  if p_action = 'assign' then
    if v_assignee is null then
      raise exception 'An assignee is required.' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.crm_user_capabilities c
      where c.profile_id = v_assignee and c.tenant_id = v_tenant and c.crm_role <> 'crm_none'
    ) then
      raise exception 'The assignee does not have CRM access in this tenant.' using errcode = '42501';
    end if;
  else
    v_assignee := v_finding.assigned_to_profile_id;
  end if;

  update public.ai_operations_findings
     set status = v_new_status,
         resolved_at = case when p_action = 'resolve' then now() else null end,
         dismissed_at = case when p_action = 'dismiss' then now() else null end,
         snoozed_until = case when p_action = 'snooze' then p_snooze_until else null end,
         reviewed_at = case when p_action = 'review' then now() else reviewed_at end,
         assigned_to_profile_id = case when p_action = 'assign' then v_assignee else assigned_to_profile_id end,
         assigned_at = case when p_action = 'assign' then now() else assigned_at end,
         reopen_count = reopen_count + case when p_action = 'reopen' then 1 else 0 end,
         updated_at = now()
   where id = p_finding_id;

  insert into public.ai_operations_finding_events (
    finding_id, tenant_id, event_type, actor_profile_id, actor_kind, reason, previous_value, new_value
  ) values (
    p_finding_id, v_tenant, p_action, v_actor, 'admin', v_reason,
    jsonb_build_object('status', v_finding.status, 'snoozedUntil', v_finding.snoozed_until, 'assignedTo', v_finding.assigned_to_profile_id),
    jsonb_build_object('status', v_new_status, 'snoozedUntil', case when p_action = 'snooze' then p_snooze_until else null end, 'assignedTo', v_assignee)
  );

  return jsonb_build_object('findingId', p_finding_id, 'status', v_new_status, 'assignedTo', v_assignee);
end;
$function$;

create or replace function public.ai_operations_review_finding(p_finding_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  return private.ai_ops_transition_finding(p_finding_id, 'review', p_reason, null, null);
end $$;

create or replace function public.ai_operations_assign_finding(p_finding_id uuid, p_assignee uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  return private.ai_ops_transition_finding(p_finding_id, 'assign', p_reason, null, p_assignee);
end $$;

create or replace function public.ai_operations_start_finding(p_finding_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  return private.ai_ops_transition_finding(p_finding_id, 'start', p_reason, null, null);
end $$;

grant execute on function public.ai_operations_review_finding(uuid, text) to authenticated;
grant execute on function public.ai_operations_assign_finding(uuid, uuid, text) to authenticated;
grant execute on function public.ai_operations_start_finding(uuid, text) to authenticated;

-- People a finding can be assigned to.
create or replace function public.command_center_assignable_users()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_context jsonb := private.ai_ops_context(true);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('profileId', c.profile_id, 'email', p.email, 'crmRole', c.crm_role) order by p.email)
    from public.crm_user_capabilities c
    join public.profiles p on p.id = c.profile_id
    where c.tenant_id = v_tenant and c.crm_role <> 'crm_none'
  ), '[]'::jsonb);
end $$;

grant execute on function public.command_center_assignable_users() to authenticated;

-- Unified finding queue. Reads existing findings only; no analysis is performed.
create or replace function public.command_center_findings(
  p_view text default 'active',
  p_category text default null,
  p_severity text default null,
  p_status text default null,
  p_module text default null,
  p_assigned_to uuid default null,
  p_since date default null,
  p_limit integer default 100,
  p_offset integer default 0
) returns jsonb
language plpgsql stable security definer set search_path to '' as $$
declare
  v_context jsonb := private.ai_ops_context(true);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
  v_actor uuid := (v_context->>'actor_id')::uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 300);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_view text := coalesce(nullif(btrim(p_view), ''), 'active');
  v_active text[] := array['open','reviewed','assigned','in_progress'];
  v_total integer;
begin
  create temporary table if not exists cc_scratch (x int) on commit drop;

  with base as (
    select f.*, private.ai_ops_finding_category(f.module) as category
    from public.ai_operations_findings f
    where f.tenant_id = v_tenant
  ), filtered as (
    select * from base b
    where (
        case v_view
          when 'active' then b.status::text = any(v_active)
          when 'mine' then b.status::text = any(v_active) and b.assigned_to_profile_id = v_actor
          when 'snoozed' then b.status::text = 'snoozed'
          when 'resolved' then b.status::text in ('resolved','dismissed')
          else true
        end
      )
      and (p_category is null or b.category = p_category)
      and (p_severity is null or b.severity::text = p_severity)
      and (p_status is null or b.status::text = p_status)
      and (p_module is null or b.module::text = p_module)
      and (p_assigned_to is null or b.assigned_to_profile_id = p_assigned_to)
      and (p_since is null or b.last_seen_at >= p_since::timestamptz)
  )
  select count(*)::int into v_total from filtered;

  return jsonb_build_object(
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'items', coalesce((
      select jsonb_agg(row_to_json(x)::jsonb) from (
        select
          f.id,
          f.module::text as module,
          private.ai_ops_finding_category(f.module) as category,
          f.fingerprint,
          f.entity_type as "entityType",
          f.entity_id as "entityId",
          f.title,
          f.summary,
          f.severity::text as severity,
          f.confidence,
          f.recommended_action as "recommendedAction",
          f.status::text as status,
          f.first_detected_at as "firstDetectedAt",
          f.last_seen_at as "lastSeenAt",
          f.snoozed_until as "snoozedUntil",
          f.reviewed_at as "reviewedAt",
          f.assigned_at as "assignedAt",
          f.assigned_to_profile_id as "assignedToProfileId",
          pr.email as "assignedToEmail",
          f.occurrence_count as "occurrenceCount",
          f.last_occurrence_date as "lastOccurrenceDate",
          f.reopen_count as "reopenCount",
          f.related_existing_exception_id as "relatedExistingExceptionId",
          f.last_run_id as "lastRunId",
          r.business_date as "businessDate"
        from public.ai_operations_findings f
        left join public.ai_operations_runs r on r.id = f.last_run_id
        left join public.profiles pr on pr.id = f.assigned_to_profile_id
        where f.tenant_id = v_tenant
          and (
            case v_view
              when 'active' then f.status::text = any(v_active)
              when 'mine' then f.status::text = any(v_active) and f.assigned_to_profile_id = v_actor
              when 'snoozed' then f.status::text = 'snoozed'
              when 'resolved' then f.status::text in ('resolved','dismissed')
              else true
            end
          )
          and (p_category is null or private.ai_ops_finding_category(f.module) = p_category)
          and (p_severity is null or f.severity::text = p_severity)
          and (p_status is null or f.status::text = p_status)
          and (p_module is null or f.module::text = p_module)
          and (p_assigned_to is null or f.assigned_to_profile_id = p_assigned_to)
          and (p_since is null or f.last_seen_at >= p_since::timestamptz)
        order by
          case f.severity when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end,
          greatest(f.last_seen_at, f.updated_at) desc
        limit v_limit offset v_offset
      ) x
    ), '[]'::jsonb)
  );
end $$;

grant execute on function public.command_center_findings(text, text, text, text, text, uuid, date, integer, integer) to authenticated;

-- Daily overview: run health, deterministic counts, latest brief, latest weekly review.
create or replace function public.command_center_overview(p_business_date date default null)
returns jsonb
language plpgsql stable security definer set search_path to '' as $$
declare
  v_context jsonb := private.ai_ops_context(true);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
  v_run public.ai_operations_runs;
  v_date date;
  v_since timestamptz;
  v_active text[] := array['open','reviewed','assigned','in_progress'];
begin
  if p_business_date is null then
    select r.* into v_run from public.ai_operations_runs r
    where r.tenant_id = v_tenant order by r.business_date desc limit 1;
  else
    select r.* into v_run from public.ai_operations_runs r
    where r.tenant_id = v_tenant and r.business_date = p_business_date;
  end if;

  v_date := coalesce(v_run.business_date, p_business_date, (now() at time zone 'America/Chicago')::date);
  v_since := v_date::timestamptz;

  return jsonb_build_object(
    'businessDate', v_date,
    'run', case when v_run.id is null then null else jsonb_build_object(
      'id', v_run.id,
      'businessDate', v_run.business_date,
      'startedAt', v_run.started_at,
      'completedAt', v_run.completed_at,
      'overallStatus', v_run.overall_status,
      'publicationStatus', v_run.publication_status
    ) end,
    'modules', coalesce((
      select jsonb_agg(jsonb_build_object(
        'module', m.module,
        'status', m.status,
        'completedAt', m.completed_at,
        'errorSummary', m.error_summary
      ) order by m.module)
      from public.ai_operations_module_runs m where m.run_id = v_run.id
    ), '[]'::jsonb),
    'counts', (
      select jsonb_build_object(
        'open', count(*) filter (where f.status::text = any(v_active)),
        'critical', count(*) filter (where f.status::text = any(v_active) and f.severity = 'critical'),
        'high', count(*) filter (where f.status::text = any(v_active) and f.severity = 'high'),
        'medium', count(*) filter (where f.status::text = any(v_active) and f.severity = 'medium'),
        'low', count(*) filter (where f.status::text = any(v_active) and f.severity = 'low'),
        'snoozed', count(*) filter (where f.status::text = 'snoozed'),
        'newSinceYesterday', count(*) filter (where f.first_detected_at >= v_since),
        'resolvedSinceYesterday', count(*) filter (where f.resolved_at >= v_since or f.dismissed_at >= v_since),
        'recurring', count(*) filter (where f.status::text = any(v_active) and (f.occurrence_count >= 3 or f.reopen_count >= 1))
      )
      from public.ai_operations_findings f where f.tenant_id = v_tenant
    ),
    'byCategory', coalesce((
      select jsonb_object_agg(t.category, t.payload) from (
        select private.ai_ops_finding_category(f.module) as category,
               jsonb_build_object(
                 'open', count(*),
                 'critical', count(*) filter (where f.severity = 'critical'),
                 'high', count(*) filter (where f.severity = 'high')
               ) as payload
        from public.ai_operations_findings f
        where f.tenant_id = v_tenant and f.status::text = any(v_active)
        group by 1
      ) t
    ), '{}'::jsonb),
    'brief', (
      select jsonb_build_object(
        'id', b.id, 'businessDate', b.business_date, 'isPartial', b.is_partial, 'status', b.status,
        'sections', b.sections, 'everythingNormal', b.everything_normal,
        'generatedAt', b.generated_at, 'model', b.model
      )
      from public.ai_operations_briefs b
      where b.tenant_id = v_tenant
      order by b.business_date desc limit 1
    ),
    'weeklyReview', (
      select jsonb_build_object('id', w.id, 'weekEnding', w.week_ending, 'result', w.structured_result, 'createdAt', w.created_at)
      from public.ai_operations_weekly_reviews w
      where w.tenant_id = v_tenant
      order by w.week_ending desc limit 1
    )
  );
end $$;

grant execute on function public.command_center_overview(date) to authenticated;

-- Yesterday -> today: deterministic comparison from finding history.
create or replace function public.command_center_changes(p_business_date date default null, p_limit integer default 25)
returns jsonb
language plpgsql stable security definer set search_path to '' as $$
declare
  v_context jsonb := private.ai_ops_context(true);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
  v_date date := coalesce(p_business_date, (
    select max(r.business_date) from public.ai_operations_runs r where r.tenant_id = v_tenant
  ), (now() at time zone 'America/Chicago')::date);
  v_since timestamptz;
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_active text[] := array['open','reviewed','assigned','in_progress'];
begin
  v_since := (v_date - 1)::timestamptz;

  return jsonb_build_object(
    'businessDate', v_date,
    'since', v_since,
    'new', coalesce((
      select jsonb_agg(x order by x->>'severity') from (
        select jsonb_build_object('id', f.id, 'title', f.title, 'severity', f.severity::text,
                                  'category', private.ai_ops_finding_category(f.module), 'module', f.module::text,
                                  'detectedAt', f.first_detected_at) as x
        from public.ai_operations_findings f
        where f.tenant_id = v_tenant and f.first_detected_at >= v_since
          and f.status::text = any(v_active)
        order by case f.severity when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end,
                 f.first_detected_at desc
        limit v_limit
      ) s
    ), '[]'::jsonb),
    'worsened', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object('id', f.id, 'title', f.title, 'severity', f.severity::text,
                                  'previousSeverity', e.previous_value->>'severity',
                                  'category', private.ai_ops_finding_category(f.module), 'module', f.module::text,
                                  'changedAt', e.created_at) as x
        from public.ai_operations_finding_events e
        join public.ai_operations_findings f on f.id = e.finding_id
        where e.tenant_id = v_tenant and e.event_type = 'severity_increased' and e.created_at >= v_since
          and f.status::text = any(v_active)
        order by e.created_at desc
        limit v_limit
      ) s
    ), '[]'::jsonb),
    'resolved', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object('id', f.id, 'title', f.title, 'severity', f.severity::text,
                                  'category', private.ai_ops_finding_category(f.module), 'module', f.module::text,
                                  'status', f.status::text,
                                  'closedAt', coalesce(f.resolved_at, f.dismissed_at)) as x
        from public.ai_operations_findings f
        where f.tenant_id = v_tenant
          and coalesce(f.resolved_at, f.dismissed_at) >= v_since
        order by coalesce(f.resolved_at, f.dismissed_at) desc
        limit v_limit
      ) s
    ), '[]'::jsonb),
    'recurring', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object('id', f.id, 'title', f.title, 'severity', f.severity::text,
                                  'category', private.ai_ops_finding_category(f.module), 'module', f.module::text,
                                  'occurrenceCount', f.occurrence_count, 'reopenCount', f.reopen_count,
                                  'firstDetectedAt', f.first_detected_at, 'lastSeenAt', f.last_seen_at,
                                  'status', f.status::text) as x
        from public.ai_operations_findings f
        where f.tenant_id = v_tenant and f.status::text = any(v_active)
          and (f.occurrence_count >= 3 or f.reopen_count >= 1)
        order by f.occurrence_count desc, f.last_seen_at desc
        limit v_limit
      ) s
    ), '[]'::jsonb)
  );
end $$;

grant execute on function public.command_center_changes(date, integer) to authenticated;
