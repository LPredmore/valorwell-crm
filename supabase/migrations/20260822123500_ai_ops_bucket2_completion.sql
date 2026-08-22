-- Complete the Bucket 2 deterministic monitoring cutover.
-- Adds an explicit automatic/manual finding contract, monitoring-specific flags,
-- evidence-aware dashboard RPCs, a richer deterministic daily summary, and
-- safe smoke-finding auto-resolution only after a flow is proven healthy.

create or replace function private.ai_ops_finding_mode(
  p_module public.ai_ops_module_enum,
  p_fingerprint text
)
returns text
language sql
immutable
set search_path = ''
as $function$
  select case
    when p_module in ('system_integrity','user_flow_smoke')
      or coalesce(p_fingerprint,'') like 'det:%'
      then 'automatic'
    else 'manual'
  end;
$function$;

create or replace function private.ai_ops_flag_names()
returns text[]
language sql
immutable
set search_path = ''
as $function$
  select array[
    'ai_operations_enabled',
    'system_integrity_enabled',
    'user_flow_smoke_enabled',
    'client_journey_monitoring_enabled',
    'staff_workflow_monitoring_enabled',
    'appointment_integrity_monitoring_enabled',
    'billing_claims_monitoring_enabled',
    'data_quality_monitoring_enabled',
    'relationship_followup_monitoring_enabled',
    'sop_compliance_monitoring_enabled',
    'client_journey_ai_enabled',
    'communications_ai_enabled',
    'donor_intelligence_ai_enabled',
    'social_leads_ai_enabled',
    'content_performance_ai_enabled',
    'bty_intelligence_ai_enabled',
    'weekly_patterns_ai_enabled',
    'youtube_ai_enabled',
    'executive_brief_enabled',
    'executive_brief_email_enabled',
    'shadow_mode'
  ]::text[];
$function$;

-- New deterministic monitoring switches are independent from legacy AI switches.
-- Preserve prior enabled/disabled choices where they represented the same automatic
-- monitor. Client Journey monitoring is infrastructure and remains enabled even
-- when the separate manual Client Journey AI review switch is off.
insert into private.ai_ops_flags(tenant_id, flag_name, enabled, updated_by_profile_id, updated_at)
select tenants.tenant_id,
       mapping.new_name,
       case when mapping.new_name='client_journey_monitoring_enabled'
            then true
            else coalesce(legacy.enabled, true)
       end,
       null,
       now()
from (select distinct tenant_id from private.ai_ops_flags) tenants
cross join (values
  ('client_journey_monitoring_enabled'::text, 'client_journey_ai_enabled'::text),
  ('staff_workflow_monitoring_enabled', 'staff_quality_ai_enabled'),
  ('appointment_integrity_monitoring_enabled', 'appointment_integrity_ai_enabled'),
  ('billing_claims_monitoring_enabled', 'billing_claims_ai_enabled'),
  ('data_quality_monitoring_enabled', 'data_quality_ai_enabled'),
  ('relationship_followup_monitoring_enabled', 'relationship_followup_ai_enabled'),
  ('sop_compliance_monitoring_enabled', 'sop_compliance_ai_enabled')
) mapping(new_name, legacy_name)
left join private.ai_ops_flags legacy
  on legacy.tenant_id=tenants.tenant_id and legacy.flag_name=mapping.legacy_name
on conflict (tenant_id, flag_name) do nothing;

-- User-flow smoke findings are deterministic, but UNKNOWN is not proof of recovery.
-- Resolve an old failing/error finding only when the current run proves that exact
-- flow healthy. Preserve the existing non-model behavior for all other modules.
create or replace function public.ai_ops_autoresolve_findings(
  p_tenant_id uuid,
  p_module public.ai_ops_module_enum,
  p_run_id uuid,
  p_observed_fingerprints text[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_count integer:=0;
  v_row record;
  v_deterministic boolean := (p_module in ('system_integrity','appointment_integrity','data_quality'));
  v_smoke_status text;
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode='42501';
  end if;

  for v_row in
    select id,status,fingerprint
    from public.ai_operations_findings
    where tenant_id=p_tenant_id
      and module=p_module
      and status in ('open','snoozed')
      and not (fingerprint=any(coalesce(p_observed_fingerprints,'{}'::text[])))
  loop
    if p_module='user_flow_smoke' then
      select sr.status into v_smoke_status
      from public.ai_operations_smoke_results sr
      where sr.tenant_id=p_tenant_id
        and sr.run_id=p_run_id
        and sr.flow_key=split_part(v_row.fingerprint,':',2)
      limit 1;

      if v_smoke_status='healthy' then
        update public.ai_operations_findings
           set status='resolved', resolved_at=now(), snoozed_until=null,
               last_run_id=p_run_id, updated_at=now()
         where id=v_row.id;
        insert into public.ai_operations_finding_events(
          finding_id,tenant_id,event_type,actor_kind,previous_value,new_value,reason
        ) values (
          v_row.id,p_tenant_id,'deterministically_resolved','system',
          jsonb_build_object('status',v_row.status),
          jsonb_build_object('status','resolved','runId',p_run_id,'flowStatus','healthy'),
          'The deterministic smoke flow is now healthy.'
        );
        v_count:=v_count+1;
      else
        insert into public.ai_operations_finding_events(
          finding_id,tenant_id,event_type,actor_kind,previous_value,new_value,reason
        ) values (
          v_row.id,p_tenant_id,'not_observed','system',
          jsonb_build_object('status',v_row.status),
          jsonb_build_object('status',v_row.status,'runId',p_run_id,'flowStatus',coalesce(v_smoke_status,'missing')),
          'The prior smoke finding was not re-observed, but the flow is not proven healthy, so it stays open.'
        );
      end if;
    elsif v_deterministic then
      update public.ai_operations_findings
         set status='resolved',resolved_at=now(),snoozed_until=null,last_run_id=p_run_id,updated_at=now()
       where id=v_row.id;
      insert into public.ai_operations_finding_events(
        finding_id,tenant_id,event_type,actor_kind,previous_value,new_value,reason
      ) values (
        v_row.id,p_tenant_id,'deterministically_resolved','system',
        jsonb_build_object('status',v_row.status),
        jsonb_build_object('status','resolved','runId',p_run_id),
        'Deterministic evidence shows the underlying condition no longer exists.'
      );
      v_count:=v_count+1;
    else
      insert into public.ai_operations_finding_events(
        finding_id,tenant_id,event_type,actor_kind,previous_value,new_value,reason
      ) values (
        v_row.id,p_tenant_id,'not_observed','system',
        jsonb_build_object('status',v_row.status),
        jsonb_build_object('status',v_row.status,'runId',p_run_id),
        'Not returned by this analysis. Absence is not proof of resolution, so the finding stays open.'
      );
    end if;
  end loop;
  return v_count;
end;
$function$;

-- V2 keeps the existing findings RPC intact for compatibility, while exposing an
-- explicit mode and the latest stored source evidence for the dashboard.
create or replace function public.ai_operations_list_findings_v2(
  p_module text default null,
  p_status text default 'open',
  p_severity text default null,
  p_business_date date default null,
  p_mode text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_context jsonb := private.ai_ops_context(true);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
  v_limit integer := least(greatest(coalesce(p_limit,50),1),200);
  v_offset integer := greatest(coalesce(p_offset,0),0);
  v_total integer;
begin
  if p_mode is not null and p_mode not in ('all','automatic','manual') then
    raise exception 'Unknown finding mode: %', p_mode using errcode='22023';
  end if;

  select count(*)::int into v_total
  from public.ai_operations_findings f
  left join public.ai_operations_runs r on r.id=f.last_run_id
  where f.tenant_id=v_tenant
    and (p_module is null or f.module::text=p_module)
    and (p_status is null or f.status::text=p_status)
    and (p_severity is null or f.severity::text=p_severity)
    and (p_business_date is null or r.business_date=p_business_date)
    and (p_mode is null or p_mode='all' or private.ai_ops_finding_mode(f.module,f.fingerprint)=p_mode);

  return jsonb_build_object(
    'total',v_total,
    'limit',v_limit,
    'offset',v_offset,
    'items',coalesce((
      select jsonb_agg(row_to_json(x)::jsonb)
      from (
        select
          f.id,
          f.module::text as module,
          f.fingerprint,
          private.ai_ops_finding_mode(f.module,f.fingerprint) as mode,
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
          f.reopen_count as "reopenCount",
          f.related_existing_exception_id as "relatedExistingExceptionId",
          r.business_date as "businessDate",
          ev.evidence,
          ev.created_at as "evidenceObservedAt"
        from public.ai_operations_findings f
        left join public.ai_operations_runs r on r.id=f.last_run_id
        left join lateral (
          select e.new_value->'evidence' as evidence,e.created_at
          from public.ai_operations_finding_events e
          where e.tenant_id=f.tenant_id
            and e.finding_id=f.id
            and e.event_type in ('detected','observed','reobserved')
            and e.new_value ? 'evidence'
          order by e.created_at desc
          limit 1
        ) ev on true
        where f.tenant_id=v_tenant
          and (p_module is null or f.module::text=p_module)
          and (p_status is null or f.status::text=p_status)
          and (p_severity is null or f.severity::text=p_severity)
          and (p_business_date is null or r.business_date=p_business_date)
          and (p_mode is null or p_mode='all' or private.ai_ops_finding_mode(f.module,f.fingerprint)=p_mode)
        order by
          case f.severity when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end,
          f.last_seen_at desc
        limit v_limit offset v_offset
      ) x
    ),'[]'::jsonb)
  );
end;
$function$;

revoke all on function public.ai_operations_list_findings_v2(text,text,text,date,text,integer,integer) from public, anon;
grant execute on function public.ai_operations_list_findings_v2(text,text,text,date,text,integer,integer) to authenticated, service_role;

-- Preserve the old aggregate fields for compatibility, while adding explicit
-- automatic/manual counts so morning monitoring totals cannot be polluted by
-- manual or historical AI findings.
create or replace function public.ai_operations_overview(p_business_date date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_context jsonb := private.ai_ops_context(true);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
  v_run public.ai_operations_runs;
  v_date date := p_business_date;
begin
  if v_date is null then
    select r.* into v_run from public.ai_operations_runs r
    where r.tenant_id=v_tenant order by r.business_date desc limit 1;
  else
    select r.* into v_run from public.ai_operations_runs r
    where r.tenant_id=v_tenant and r.business_date=v_date;
  end if;

  return jsonb_build_object(
    'run',case when v_run.id is null then null else jsonb_build_object(
      'id',v_run.id,'businessDate',v_run.business_date,'timezone',v_run.timezone,
      'startedAt',v_run.started_at,'sourceCutoffAt',v_run.source_cutoff_at,
      'completedAt',v_run.completed_at,'overallStatus',v_run.overall_status,
      'publicationStatus',v_run.publication_status,'coverageSummary',v_run.coverage_summary
    ) end,
    'modules',coalesce((
      select jsonb_agg(jsonb_build_object(
        'module',m.module,'status',m.status,'startedAt',m.started_at,'completedAt',m.completed_at,
        'sourceItemsTotal',m.source_items_total,'itemsAnalyzed',m.items_analyzed,
        'itemsReused',m.items_reused,'itemsFailed',m.items_failed,'coverage',m.coverage,
        'model',m.model,'errorCode',m.error_code,'errorSummary',m.error_summary
      ) order by m.module)
      from public.ai_operations_module_runs m where m.run_id=v_run.id
    ),'[]'::jsonb),
    'findingCounts',coalesce((
      select jsonb_object_agg(key,value) from (
        select f.severity::text key,count(*)::int value
        from public.ai_operations_findings f
        where f.tenant_id=v_tenant and f.status='open'
        group by f.severity
      ) s
    ),'{}'::jsonb),
    'automaticFindingCounts',coalesce((
      select jsonb_object_agg(key,value) from (
        select f.severity::text key,count(*)::int value
        from public.ai_operations_findings f
        where f.tenant_id=v_tenant and f.status='open'
          and private.ai_ops_finding_mode(f.module,f.fingerprint)='automatic'
        group by f.severity
      ) s
    ),'{}'::jsonb),
    'manualFindingCounts',coalesce((
      select jsonb_object_agg(key,value) from (
        select f.severity::text key,count(*)::int value
        from public.ai_operations_findings f
        where f.tenant_id=v_tenant and f.status='open'
          and private.ai_ops_finding_mode(f.module,f.fingerprint)='manual'
        group by f.severity
      ) s
    ),'{}'::jsonb),
    'automaticOpenCount',(
      select count(*)::int from public.ai_operations_findings f
      where f.tenant_id=v_tenant and f.status='open'
        and private.ai_ops_finding_mode(f.module,f.fingerprint)='automatic'
    ),
    'manualOpenCount',(
      select count(*)::int from public.ai_operations_findings f
      where f.tenant_id=v_tenant and f.status='open'
        and private.ai_ops_finding_mode(f.module,f.fingerprint)='manual'
    ),
    'openFindingsByModule',coalesce((
      select jsonb_object_agg(key,value) from (
        select f.module::text key,count(*)::int value
        from public.ai_operations_findings f
        where f.tenant_id=v_tenant and f.status='open'
        group by f.module
      ) s
    ),'{}'::jsonb),
    'automaticOpenFindingsByModule',coalesce((
      select jsonb_object_agg(key,value) from (
        select f.module::text key,count(*)::int value
        from public.ai_operations_findings f
        where f.tenant_id=v_tenant and f.status='open'
          and private.ai_ops_finding_mode(f.module,f.fingerprint)='automatic'
        group by f.module
      ) s
    ),'{}'::jsonb),
    'manualOpenFindingsByModule',coalesce((
      select jsonb_object_agg(key,value) from (
        select f.module::text key,count(*)::int value
        from public.ai_operations_findings f
        where f.tenant_id=v_tenant and f.status='open'
          and private.ai_ops_finding_mode(f.module,f.fingerprint)='manual'
        group by f.module
      ) s
    ),'{}'::jsonb),
    'brief',(
      select jsonb_build_object(
        'id',b.id,'businessDate',b.business_date,'isPartial',b.is_partial,'status',b.status,
        'generatedAt',b.generated_at,'publishedAt',b.published_at,'emailStatus',b.email_status
      )
      from public.ai_operations_briefs b
      where b.tenant_id=v_tenant and (v_run.id is null or b.run_id=v_run.id)
      order by b.business_date desc limit 1
    )
  );
end;
$function$;

-- The deterministic summary now uses the same automatic/manual contract as the
-- dashboard, includes System Integrity and smoke findings, and reports the morning
-- operational counters directly without model synthesis.
create or replace function public.ai_ops_publish_deterministic_daily_summary(
  p_tenant_id uuid,
  p_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_date date;
  v_sections jsonb;
  v_normal jsonb;
  v_coverage jsonb;
  v_open integer;
  v_manual_open integer;
  v_new integer;
  v_still_open integer;
  v_reopened integer;
  v_resolved integer;
  v_high integer;
  v_critical integer;
  v_aged integer;
  v_expected integer;
  v_checked integer;
  v_healthy integer;
  v_failed integer;
  v_records integer;
  v_partial boolean;
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode='42501';
  end if;

  select business_date into v_date
  from public.ai_operations_runs
  where id=p_run_id and tenant_id=p_tenant_id;
  if v_date is null then raise exception 'AI Operations run not found.'; end if;

  select
    count(*) filter(where private.ai_ops_finding_mode(f.module,f.fingerprint)='automatic')::int,
    count(*) filter(where private.ai_ops_finding_mode(f.module,f.fingerprint)='manual')::int,
    count(*) filter(where private.ai_ops_finding_mode(f.module,f.fingerprint)='automatic'
      and (f.first_detected_at at time zone 'America/Chicago')::date=v_date)::int,
    count(*) filter(where private.ai_ops_finding_mode(f.module,f.fingerprint)='automatic'
      and (f.first_detected_at at time zone 'America/Chicago')::date<v_date)::int,
    count(*) filter(where private.ai_ops_finding_mode(f.module,f.fingerprint)='automatic' and f.severity='critical')::int,
    count(*) filter(where private.ai_ops_finding_mode(f.module,f.fingerprint)='automatic' and f.severity='high')::int,
    count(*) filter(where private.ai_ops_finding_mode(f.module,f.fingerprint)='automatic' and (
      f.fingerprint like '%:overdue_%' or f.fingerprint like '%:followup_overdue:%'
      or f.fingerprint like '%:followup_overdue_more_than_3d:%'
      or f.fingerprint like '%:no_movement_%' or f.fingerprint like '%:accepted_no_movement_14d:%'
      or f.fingerprint like '%:past_appointment_still_scheduled:%'
      or f.fingerprint like '%:past_appointments_still_scheduled:%'
      or f.fingerprint like '%:match_expired:%' or f.fingerprint like '%:at_risk_without_recent_progress:%'
    ))::int
  into v_open,v_manual_open,v_new,v_still_open,v_critical,v_high,v_aged
  from public.ai_operations_findings f
  where f.tenant_id=p_tenant_id and f.status='open';

  select count(*)::int into v_reopened
  from public.ai_operations_finding_events e
  join public.ai_operations_findings f on f.id=e.finding_id
  where e.tenant_id=p_tenant_id and e.event_type='reopened'
    and (e.created_at at time zone 'America/Chicago')::date=v_date
    and private.ai_ops_finding_mode(f.module,f.fingerprint)='automatic';

  select count(*)::int into v_resolved
  from public.ai_operations_finding_events e
  join public.ai_operations_findings f on f.id=e.finding_id
  where e.tenant_id=p_tenant_id and e.event_type='deterministically_resolved'
    and (e.created_at at time zone 'America/Chicago')::date=v_date
    and private.ai_ops_finding_mode(f.module,f.fingerprint)='automatic';

  select count(*)::int into v_expected
  from (values
    ('system_integrity_enabled'::text),('user_flow_smoke_enabled'),('client_journey_monitoring_enabled'),
    ('staff_workflow_monitoring_enabled'),('appointment_integrity_monitoring_enabled'),
    ('billing_claims_monitoring_enabled'),('data_quality_monitoring_enabled'),
    ('relationship_followup_monitoring_enabled'),('sop_compliance_monitoring_enabled')
  ) flags(flag_name)
  where private.ai_ops_flag(p_tenant_id,flags.flag_name);

  select
    count(*)::int,
    count(*) filter(where m.status='success')::int,
    count(*) filter(where m.status<>'success')::int,
    coalesce(sum(m.source_items_total),0)::int
  into v_checked,v_healthy,v_failed,v_records
  from public.ai_operations_module_runs m
  where m.run_id=p_run_id
    and m.module in ('system_integrity','user_flow_smoke','client_journey','staff_quality','appointment_integrity','billing_claims','data_quality','relationship_followup','sop_compliance');

  v_partial := v_failed>0 or v_checked<v_expected;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'key',module,
      'heading',initcap(replace(module,'_',' ')),
      'body',format('%s open automatic finding(s).',cnt),
      'severity',case when criticals>0 then 'critical' when highs>0 then 'high' when mediums>0 then 'medium' else 'low' end,
      'itemCount',cnt
    ) order by case when criticals>0 then 0 when highs>0 then 1 when mediums>0 then 2 else 3 end,module
  ),'[]'::jsonb)
  into v_sections
  from (
    select f.module::text module,count(*)::int cnt,
      count(*) filter(where f.severity='critical')::int criticals,
      count(*) filter(where f.severity='high')::int highs,
      count(*) filter(where f.severity='medium')::int mediums
    from public.ai_operations_findings f
    where f.tenant_id=p_tenant_id and f.status='open'
      and private.ai_ops_finding_mode(f.module,f.fingerprint)='automatic'
    group by f.module
  ) s;

  select coalesce(jsonb_agg(m.module::text order by m.module::text),'[]'::jsonb)
  into v_normal
  from public.ai_operations_module_runs m
  where m.run_id=p_run_id and m.status='success' and m.model='deterministic'
    and m.module in ('system_integrity','user_flow_smoke','client_journey','staff_quality','appointment_integrity','billing_claims','data_quality','relationship_followup','sop_compliance')
    and not exists (
      select 1 from public.ai_operations_findings f
      where f.tenant_id=p_tenant_id and f.module=m.module and f.status='open'
        and private.ai_ops_finding_mode(f.module,f.fingerprint)='automatic'
    );

  select jsonb_build_object(
    'modules',coalesce(jsonb_agg(jsonb_build_object(
      'module',m.module::text,'status',m.status::text,'model',m.model,'coverage',m.coverage
    ) order by m.module::text),'[]'::jsonb),
    'automaticOpenFindings',v_open,
    'manualOpenFindings',v_manual_open,
    'newToday',v_new,
    'stillOpenFromPriorDays',v_still_open,
    'reopenedToday',v_reopened,
    'resolvedToday',v_resolved,
    'criticalOpen',v_critical,
    'highOpen',v_high,
    'agedOrOverdueOpen',v_aged,
    'modulesExpected',v_expected,
    'modulesChecked',v_checked,
    'modulesHealthy',v_healthy,
    'modulesFailed',v_failed,
    'recordsExamined',v_records
  ) into v_coverage
  from public.ai_operations_module_runs m
  where m.run_id=p_run_id
    and m.module in ('system_integrity','user_flow_smoke','client_journey','staff_quality','appointment_integrity','billing_claims','data_quality','relationship_followup','sop_compliance');

  insert into public.ai_operations_briefs(
    run_id,tenant_id,business_date,is_partial,status,sections,coverage_manifest,everything_normal,
    generated_at,published_at,email_status,prompt_version,model,updated_at
  ) values (
    p_run_id,p_tenant_id,v_date,v_partial,'published',coalesce(v_sections,'[]'::jsonb),coalesce(v_coverage,'{}'::jsonb),
    coalesce(v_normal,'[]'::jsonb),now(),now(),'not_sent','deterministic-v2','deterministic',now()
  )
  on conflict (tenant_id,business_date) do update set
    run_id=excluded.run_id,is_partial=excluded.is_partial,status='published',sections=excluded.sections,
    coverage_manifest=excluded.coverage_manifest,everything_normal=excluded.everything_normal,
    generated_at=excluded.generated_at,published_at=excluded.published_at,email_status='not_sent',
    prompt_version='deterministic-v2',model='deterministic',updated_at=now();

  update public.ai_operations_runs set publication_status='published',updated_at=now() where id=p_run_id;

  return jsonb_build_object(
    'status','published','businessDate',v_date,'automaticOpenFindings',v_open,'manualOpenFindings',v_manual_open,
    'newToday',v_new,'stillOpenFromPriorDays',v_still_open,'reopenedToday',v_reopened,'resolvedToday',v_resolved,
    'criticalOpen',v_critical,'highOpen',v_high,'agedOrOverdueOpen',v_aged,
    'modulesExpected',v_expected,'modulesChecked',v_checked,'modulesHealthy',v_healthy,'modulesFailed',v_failed,
    'recordsExamined',v_records,'partial',v_partial,'model','deterministic'
  );
end;
$function$;
