create table if not exists public.ai_operations_bty_briefs (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, run_id uuid references public.ai_operations_runs(id) on delete set null,
 meeting_id uuid, organization_id uuid, opportunity_id uuid, contact_id uuid, brief_type text not null check(brief_type in('prep','post_interview')),
 business_date date not null, source_sufficient boolean not null default true, structured_result jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(tenant_id,meeting_id,brief_type,business_date)
);
alter table public.ai_operations_bty_briefs enable row level security;
drop policy if exists "AI Ops BTY briefs are admin readable" on public.ai_operations_bty_briefs;
create policy "AI Ops BTY briefs are admin readable" on public.ai_operations_bty_briefs for select to authenticated using(private.ai_ops_is_admin_of(tenant_id));
drop policy if exists "AI Ops BTY briefs are worker managed" on public.ai_operations_bty_briefs;
create policy "AI Ops BTY briefs are worker managed" on public.ai_operations_bty_briefs for all to service_role using(true) with check(true);

create table if not exists public.ai_operations_weekly_reviews (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, run_id uuid references public.ai_operations_runs(id) on delete set null,
 week_ending date not null, structured_result jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(tenant_id,week_ending)
);
alter table public.ai_operations_weekly_reviews enable row level security;
drop policy if exists "AI Ops weekly reviews are admin readable" on public.ai_operations_weekly_reviews;
create policy "AI Ops weekly reviews are admin readable" on public.ai_operations_weekly_reviews for select to authenticated using(private.ai_ops_is_admin_of(tenant_id));
drop policy if exists "AI Ops weekly reviews are worker managed" on public.ai_operations_weekly_reviews;
create policy "AI Ops weekly reviews are worker managed" on public.ai_operations_weekly_reviews for all to service_role using(true) with check(true);

create table if not exists public.ai_operations_sop_controls (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, control_key text not null, domain text not null,
 source_doc_name text not null, source_doc_locator text, control_text text not null, evidence_contract jsonb not null default '{}'::jsonb,
 enabled boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(tenant_id,control_key)
);
alter table public.ai_operations_sop_controls enable row level security;
drop policy if exists "AI Ops SOP controls are admin readable" on public.ai_operations_sop_controls;
create policy "AI Ops SOP controls are admin readable" on public.ai_operations_sop_controls for select to authenticated using(private.ai_ops_is_admin_of(tenant_id));
drop policy if exists "AI Ops SOP controls are worker managed" on public.ai_operations_sop_controls;
create policy "AI Ops SOP controls are worker managed" on public.ai_operations_sop_controls for all to service_role using(true) with check(true);

create table if not exists public.ai_operations_sop_observations (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, control_key text not null, observed_at timestamptz not null,
 entity_type text, entity_id text, evidence jsonb not null default '{}'::jsonb, source_reference text, created_at timestamptz not null default now()
);
alter table public.ai_operations_sop_observations enable row level security;
drop policy if exists "AI Ops SOP observations are admin readable" on public.ai_operations_sop_observations;
create policy "AI Ops SOP observations are admin readable" on public.ai_operations_sop_observations for select to authenticated using(private.ai_ops_is_admin_of(tenant_id));
drop policy if exists "AI Ops SOP observations are worker managed" on public.ai_operations_sop_observations;
create policy "AI Ops SOP observations are worker managed" on public.ai_operations_sop_observations for all to service_role using(true) with check(true);

create or replace function public.ai_ops_build_bty_intelligence_batches(p_tenant_id uuid,p_run_id uuid,p_cutoff_at timestamptz default now()) returns jsonb
language plpgsql security definer set search_path to '' as $function$
declare v_row record;v_payload jsonb;v_key text;v_prep int:=0;v_post int:=0;v_unavailable int:=0;v_date date;
begin
 if not private.valorwell_is_service_role() then raise exception 'AI Operations worker functions require the service role.' using errcode='42501';end if;
 select business_date into v_date from public.ai_operations_runs where id=p_run_id and tenant_id=p_tenant_id;
 for v_row in
  select m.id,m.organization_id,m.contact_id,m.opportunity_id,m.purpose,m.starts_at,m.ends_at,m.event_status,m.streamyard_url,
   o.name organization_name,o.website,o.organization_kind,o.veteran_affiliated,o.relationship_stage,
   c.first_name,c.last_name,c.preferred_name,c.veteran_affiliation,
   ro.status opportunity_status,ro.cause_area,ro.next_action,ro.qualification,
   (select jsonb_agg(jsonb_build_object('occurredAt',i.occurred_at,'type',i.interaction_type,'summary',left(coalesce(i.summary,''),1200)) order by i.occurred_at desc)
    from (select * from public.relationship_interactions i where i.tenant_id=p_tenant_id and (i.organization_id=m.organization_id or (m.contact_id is not null and i.contact_id=m.contact_id) or (m.opportunity_id is not null and i.opportunity_id=m.opportunity_id)) order by i.occurred_at desc limit 10) i) recent_interactions
  from public.relationship_meetings m
  join public.relationship_organizations o on o.id=m.organization_id and o.tenant_id=m.tenant_id
  left join public.relationship_contacts c on c.id=m.contact_id and c.tenant_id=m.tenant_id
  left join public.relationship_opportunities ro on ro.id=m.opportunity_id and ro.tenant_id=m.tenant_id
  where m.tenant_id=p_tenant_id
    and exists(select 1 from public.relationship_organization_roles r where r.tenant_id=p_tenant_id and r.organization_id=m.organization_id and r.role_code='bty_nominee')
    and (
      (m.starts_at between p_cutoff_at and p_cutoff_at+interval '14 days' and coalesce(m.event_status,'') not in('cancelled','deleted'))
      or (m.ends_at between p_cutoff_at-interval '2 days' and p_cutoff_at and coalesce(m.event_status,'') not in('cancelled','deleted'))
    )
  order by m.starts_at
 loop
   v_key:='bty'||left(md5(v_row.id::text||p_run_id::text),12);
   v_payload:=jsonb_build_object('entityKey',v_key,'meetingPurpose',v_row.purpose,'startsAt',v_row.starts_at,'endsAt',v_row.ends_at,'eventStatus',v_row.event_status,'organization',jsonb_build_object('name',v_row.organization_name,'website',v_row.website,'kind',v_row.organization_kind,'veteranAffiliated',v_row.veteran_affiliated,'relationshipStage',v_row.relationship_stage),'contact',case when v_row.contact_id is null then null else jsonb_build_object('name',trim(concat_ws(' ',coalesce(v_row.preferred_name,v_row.first_name),v_row.last_name)),'veteranAffiliation',v_row.veteran_affiliation) end,'opportunity',case when v_row.opportunity_id is null then null else jsonb_build_object('status',v_row.opportunity_status,'causeArea',v_row.cause_area,'nextAction',v_row.next_action,'qualification',v_row.qualification) end,'recentInteractions',coalesce(v_row.recent_interactions,'[]'::jsonb),'sourceTimestamp',v_row.starts_at);
   insert into private.ai_ops_snapshots(tenant_id,entity_type,entity_id,snapshot_type,snapshot_hash,evaluation_hash,cutoff_at,payload,expires_at) values(p_tenant_id,'relationship_meeting',v_row.id::text,'bty_intelligence:'||p_run_id::text,v_key,md5((v_payload-'entityKey')::text),p_cutoff_at,v_payload,now()+interval '30 days');
   if v_row.starts_at>=p_cutoff_at then
      perform public.ai_ops_enqueue_work(p_tenant_id,p_run_id,'bty_intelligence','bty_prep:'||v_row.id::text||':'||v_date::text,'bty_interview_prep',jsonb_build_object('entities',jsonb_build_array(v_payload)),'1','1',65,'gemini-2.5-pro','{}'::uuid[]);v_prep:=v_prep+1;
   else
      if jsonb_array_length(coalesce(v_row.recent_interactions,'[]'::jsonb))=0 then v_unavailable:=v_unavailable+1;
      else perform public.ai_ops_enqueue_work(p_tenant_id,p_run_id,'bty_intelligence','bty_post:'||v_row.id::text||':'||v_date::text,'bty_post_interview_review',jsonb_build_object('entities',jsonb_build_array(v_payload)),'1','1',65,'gemini-2.5-pro','{}'::uuid[]);v_post:=v_post+1;end if;
   end if;
 end loop;
 return jsonb_build_object('sourceAvailable',true,'prepItemsQueued',v_prep,'postInterviewItemsQueued',v_post,'postInterviewSourceUnavailable',v_unavailable,'sourceItemsTotal',v_prep+v_post+v_unavailable,'itemsQueued',v_prep+v_post,'batchesQueued',v_prep+v_post,'cutoffAt',p_cutoff_at);
end;$function$;

create or replace function public.ai_ops_ingest_bty_intelligence_results(p_tenant_id uuid,p_run_id uuid) returns jsonb
language plpgsql security definer set search_path to '' as $function$
declare v_item record;v_result jsonb;v_snap record;v_date date;v_count int:=0;v_type text;
begin
 if not private.valorwell_is_service_role() then raise exception 'AI Operations worker functions require the service role.' using errcode='42501';end if;
 select business_date into v_date from public.ai_operations_runs where id=p_run_id and tenant_id=p_tenant_id;
 for v_item in select work_type,structured_result from private.ai_ops_work_items where tenant_id=p_tenant_id and run_id=p_run_id and module='bty_intelligence' and status='completed' loop
  v_type:=case when v_item.work_type='bty_post_interview_review' then 'post_interview' else 'prep' end;
  for v_result in select value from jsonb_array_elements(coalesce(v_item.structured_result->'results','[]'::jsonb)) loop
    select entity_id,payload into v_snap from private.ai_ops_snapshots where tenant_id=p_tenant_id and snapshot_type='bty_intelligence:'||p_run_id::text and snapshot_hash=v_result->>'entityKey' limit 1;
    if v_snap.entity_id is null then continue;end if;
    insert into public.ai_operations_bty_briefs(tenant_id,run_id,meeting_id,organization_id,opportunity_id,contact_id,brief_type,business_date,source_sufficient,structured_result)
    values(p_tenant_id,p_run_id,v_snap.entity_id::uuid,nullif(v_snap.payload#>>'{organization,id}','')::uuid,nullif(v_snap.payload#>>'{opportunity,id}','')::uuid,nullif(v_snap.payload#>>'{contact,id}','')::uuid,v_type,v_date,coalesce((v_result->>'sourceSufficient')::boolean,true),v_result)
    on conflict(tenant_id,meeting_id,brief_type,business_date) do update set structured_result=excluded.structured_result,source_sufficient=excluded.source_sufficient,run_id=excluded.run_id,updated_at=now();
    v_count:=v_count+1;
  end loop;
 end loop;
 return jsonb_build_object('briefsIngested',v_count);
end;$function$;

create or replace function public.ai_ops_build_weekly_pattern_input(p_tenant_id uuid,p_run_id uuid,p_cutoff_at timestamptz default now()) returns jsonb
language plpgsql security definer set search_path to '' as $function$
declare v_date date;v_payload jsonb;v_dow int;
begin
 if not private.valorwell_is_service_role() then raise exception 'AI Operations worker functions require the service role.' using errcode='42501';end if;
 select business_date,extract(isodow from business_date)::int into v_date,v_dow from public.ai_operations_runs where id=p_run_id and tenant_id=p_tenant_id;
 if v_dow<>5 then return jsonb_build_object('skipped','not_friday','sourceItemsTotal',0,'itemsQueued',0,'batchesQueued',0);end if;
 v_payload:=jsonb_build_object('weekEnding',v_date,
   'findingSummary',(select coalesce(jsonb_agg(x),'[]'::jsonb) from (select module::text,severity::text,status::text,count(*)::int occurrenceCount,count(distinct fingerprint)::int distinctFindings from public.ai_operations_findings where tenant_id=p_tenant_id and last_seen_at>=p_cutoff_at-interval '7 days' group by module,severity,status order by module,severity) x),
   'recurringFindings',(select coalesce(jsonb_agg(x),'[]'::jsonb) from (select module::text,title,severity::text,reopen_count,first_detected_at,last_seen_at from public.ai_operations_findings where tenant_id=p_tenant_id and last_seen_at>=p_cutoff_at-interval '7 days' and (reopen_count>0 or first_detected_at<p_cutoff_at-interval '3 days') order by severity,reopen_count desc limit 50) x),
   'moduleCoverage',(select coalesce(jsonb_agg(x),'[]'::jsonb) from (select mr.module::text,mr.status::text,count(*)::int runCount,sum(mr.items_failed)::int failedItems from public.ai_operations_module_runs mr join public.ai_operations_runs r on r.id=mr.run_id where mr.tenant_id=p_tenant_id and r.business_date between v_date-6 and v_date group by mr.module,mr.status) x));
 perform public.ai_ops_enqueue_work(p_tenant_id,p_run_id,'weekly_patterns','weekly_patterns:'||v_date::text,'weekly_pattern_review',v_payload,'1','1',90,'gemini-2.5-pro','{}'::uuid[]);
 return jsonb_build_object('sourceItemsTotal',1,'itemsQueued',1,'batchesQueued',1,'weekEnding',v_date);
end;$function$;

create or replace function public.ai_ops_ingest_weekly_patterns(p_tenant_id uuid,p_run_id uuid) returns jsonb
language plpgsql security definer set search_path to '' as $function$
declare v_date date;v_result jsonb;v_count int:=0;v_pattern jsonb;v_sev public.ai_ops_severity_enum;v_key text;
begin
 if not private.valorwell_is_service_role() then raise exception 'AI Operations worker functions require the service role.' using errcode='42501';end if;
 select business_date into v_date from public.ai_operations_runs where id=p_run_id and tenant_id=p_tenant_id;
 select structured_result into v_result from private.ai_ops_work_items where tenant_id=p_tenant_id and run_id=p_run_id and module='weekly_patterns' and work_type='weekly_pattern_review' and status='completed' order by completed_at desc limit 1;
 if v_result is null then return jsonb_build_object('status','pending','reviewsIngested',0);end if;
 insert into public.ai_operations_weekly_reviews(tenant_id,run_id,week_ending,structured_result) values(p_tenant_id,p_run_id,v_date,v_result) on conflict(tenant_id,week_ending) do update set run_id=excluded.run_id,structured_result=excluded.structured_result,updated_at=now();
 for v_pattern in select value from jsonb_array_elements(coalesce(v_result->'patterns','[]'::jsonb)) loop
   v_sev:=coalesce(nullif(v_pattern->>'severity',''),'medium')::public.ai_ops_severity_enum;
   if v_sev in('critical','high') then v_key:=md5(coalesce(v_pattern->>'title','')||v_date::text);perform public.ai_ops_upsert_finding(p_tenant_id,p_run_id,'weekly_patterns','weekly_pattern:'||v_key,left(coalesce(v_pattern->>'title','Weekly operational pattern'),300),v_sev,left(coalesce(v_pattern->>'summary',''),2000),left(coalesce(v_pattern->>'recommendedAction',''),1000),'weekly_pattern',v_key,nullif(v_pattern->>'confidence','')::numeric,null,jsonb_build_array(jsonb_build_object('sourceType','ai_operations_history','sourceRecordId',v_date::text,'sourceTimestamp',p_cutoff_at,'excerpt',left(coalesce(v_pattern->>'summary',''),500),'evidenceHash',md5(v_pattern::text))));end if;v_count:=v_count+1;
 end loop;
 return jsonb_build_object('reviewsIngested',1,'patternsIngested',v_count);
end;$function$;

create or replace function public.ai_ops_build_sop_compliance_batches(p_tenant_id uuid,p_run_id uuid,p_cutoff_at timestamptz default now(),p_batch_size integer default 6) returns jsonb
language plpgsql security definer set search_path to '' as $function$
declare v_controls int;v_observations int;v_entities jsonb:='[]'::jsonb;v_row record;v_key text;v_batch int:=0;v_batch_size int:=least(greatest(coalesce(p_batch_size,6),3),8);
begin
 if not private.valorwell_is_service_role() then raise exception 'AI Operations worker functions require the service role.' using errcode='42501';end if;
 select count(*) into v_controls from public.ai_operations_sop_controls where tenant_id=p_tenant_id and enabled;
 if v_controls=0 then return jsonb_build_object('sourceAvailable',false,'unavailableReason','no_runtime_sop_controls_mirrored','sourceItemsTotal',0,'itemsQueued',0,'batchesQueued',0);end if;
 select count(*) into v_observations from public.ai_operations_sop_observations where tenant_id=p_tenant_id and observed_at>=p_cutoff_at-interval '24 hours';
 if v_observations=0 then return jsonb_build_object('sourceAvailable',false,'unavailableReason','no_sop_observation_contracts_emitting','controlsAvailable',v_controls,'sourceItemsTotal',0,'itemsQueued',0,'batchesQueued',0);end if;
 for v_row in select c.control_key,c.domain,c.source_doc_name,c.control_text,o.entity_type,o.entity_id,o.observed_at,o.evidence,o.source_reference from public.ai_operations_sop_controls c join public.ai_operations_sop_observations o on o.tenant_id=c.tenant_id and o.control_key=c.control_key where c.tenant_id=p_tenant_id and c.enabled and o.observed_at>=p_cutoff_at-interval '24 hours' order by c.control_key,o.observed_at loop
   v_key:='sop'||left(md5(v_row.control_key||coalesce(v_row.entity_id,'')||p_run_id::text),12);v_entities:=v_entities||jsonb_build_object('entityKey',v_key,'controlKey',v_row.control_key,'domain',v_row.domain,'sourceDocument',v_row.source_doc_name,'control',v_row.control_text,'observedEvidence',v_row.evidence,'sourceReference',v_row.source_reference,'sourceTimestamp',v_row.observed_at);
   if jsonb_array_length(v_entities)>=v_batch_size then v_batch:=v_batch+1;perform public.ai_ops_enqueue_work(p_tenant_id,p_run_id,'sop_compliance','sop_compliance:'||p_run_id::text||':'||v_batch,'sop_compliance_review',jsonb_build_object('entities',v_entities),'1','1',55,'gemini-2.5-pro','{}'::uuid[]);v_entities:='[]'::jsonb;end if;
 end loop;
 if jsonb_array_length(v_entities)>0 then v_batch:=v_batch+1;perform public.ai_ops_enqueue_work(p_tenant_id,p_run_id,'sop_compliance','sop_compliance:'||p_run_id::text||':'||v_batch,'sop_compliance_review',jsonb_build_object('entities',v_entities),'1','1',55,'gemini-2.5-pro','{}'::uuid[]);end if;
 return jsonb_build_object('sourceAvailable',true,'controlsAvailable',v_controls,'observationsAvailable',v_observations,'sourceItemsTotal',v_observations,'itemsQueued',v_observations,'batchesQueued',v_batch);
end;$function$;
create or replace function public.ai_ops_ingest_sop_compliance_results(p_tenant_id uuid,p_run_id uuid) returns jsonb language sql security definer set search_path to '' as $$select public.ai_ops_ingest_generic_results(p_tenant_id,p_run_id,'sop_compliance'::public.ai_ops_module_enum);$$;

insert into private.ai_ops_flags(tenant_id,flag_name,enabled) values
('00000000-0000-0000-0000-000000000001','bty_intelligence_ai_enabled',true),
('00000000-0000-0000-0000-000000000001','weekly_patterns_ai_enabled',true),
('00000000-0000-0000-0000-000000000001','sop_compliance_ai_enabled',true)
on conflict(tenant_id,flag_name) do update set enabled=excluded.enabled,updated_at=now();