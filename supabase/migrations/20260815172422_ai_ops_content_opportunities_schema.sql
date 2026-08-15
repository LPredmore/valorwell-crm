alter type public.ai_ops_module_enum add value if not exists 'content_opportunities';

create table if not exists public.ai_operations_content_opportunities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  run_id uuid references public.ai_operations_runs(id) on delete set null,
  business_date date not null,
  topic_key text not null,
  topic text not null,
  why_now text,
  audience text,
  recommended_format text,
  suggested_angle text,
  priority public.ai_ops_severity_enum not null default 'medium',
  sources jsonb not null default '[]'::jsonb,
  status text not null default 'new' check (status in ('new','reviewed','planned','dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id,business_date,topic_key)
);

alter table public.ai_operations_content_opportunities enable row level security;
drop policy if exists "AI Ops content opportunities are admin readable" on public.ai_operations_content_opportunities;
create policy "AI Ops content opportunities are admin readable" on public.ai_operations_content_opportunities for select to authenticated using (private.ai_ops_is_admin_of(tenant_id));
drop policy if exists "AI Ops content opportunities are worker managed" on public.ai_operations_content_opportunities;
create policy "AI Ops content opportunities are worker managed" on public.ai_operations_content_opportunities for all to service_role using (true) with check (true);

create index if not exists ai_operations_content_opportunities_date_idx on public.ai_operations_content_opportunities(tenant_id,business_date desc,priority);

create or replace function public.ai_ops_build_content_opportunity_input(p_tenant_id uuid,p_run_id uuid,p_cutoff_at timestamptz default now()) returns jsonb
language plpgsql security definer set search_path to '' as $function$
declare v_date date; v_payload jsonb;
begin
  if not private.valorwell_is_service_role() then raise exception 'AI Operations worker functions require the service role.' using errcode='42501'; end if;
  select business_date into v_date from public.ai_operations_runs where id=p_run_id and tenant_id=p_tenant_id;
  if v_date is null then raise exception 'Unknown AI Operations run.' using errcode='P0002'; end if;
  v_payload:=jsonb_build_object(
    'businessDate',v_date,
    'organization','ValorWell',
    'missionContext','Veteran and military-family mental health access, practical care navigation, nonprofit impact, community partnerships, and Beyond The Yellow stories about organizations doing concrete work.',
    'audiences',jsonb_build_array('veterans','military families','mental health clinicians','donors','community partners'),
    'searchWindow','Prefer developments from the last 72 hours; use older context only when needed to explain a current development.',
    'requirements',jsonb_build_array('Find timely topics with a concrete reason to publish now','Prefer actionable or consequential developments over generic awareness content','Do not invent urgency','Avoid partisan advocacy','Return source-backed opportunities only'),
    'cutoffAt',p_cutoff_at
  );
  perform public.ai_ops_enqueue_work(p_tenant_id,p_run_id,'content_opportunities','content_opportunities:'||p_run_id::text,'content_opportunity_review',v_payload,'1','1',80,'gemini-2.5-pro','{}'::uuid[]);
  return jsonb_build_object('sourceItemsTotal',1,'itemsQueued',1,'batchesQueued',1,'cutoffAt',p_cutoff_at);
end;$function$;

create or replace function public.ai_ops_ingest_content_opportunities(p_tenant_id uuid,p_run_id uuid) returns jsonb
language plpgsql security definer set search_path to '' as $function$
declare v_item record; v_opp jsonb; v_date date; v_count int:=0; v_key text; v_priority public.ai_ops_severity_enum; v_sources jsonb;
begin
  if not private.valorwell_is_service_role() then raise exception 'AI Operations worker functions require the service role.' using errcode='42501'; end if;
  select business_date into v_date from public.ai_operations_runs where id=p_run_id and tenant_id=p_tenant_id;
  for v_item in select structured_result,token_usage from private.ai_ops_work_items where tenant_id=p_tenant_id and run_id=p_run_id and module='content_opportunities' and work_type='content_opportunity_review' and status='completed' loop
    for v_opp in select value from jsonb_array_elements(coalesce(v_item.structured_result->'opportunities','[]'::jsonb)) loop
      if coalesce(v_opp->>'topic','')='' then continue; end if;
      v_key:=md5(lower(trim(v_opp->>'topic')));
      v_priority:=case lower(coalesce(v_opp->>'priority','medium')) when 'high' then 'high'::public.ai_ops_severity_enum when 'low' then 'low'::public.ai_ops_severity_enum else 'medium'::public.ai_ops_severity_enum end;
      v_sources:=coalesce(v_opp->'sources',v_item.token_usage->'groundingSources','[]'::jsonb);
      insert into public.ai_operations_content_opportunities(tenant_id,run_id,business_date,topic_key,topic,why_now,audience,recommended_format,suggested_angle,priority,sources)
      values(p_tenant_id,p_run_id,v_date,v_key,left(v_opp->>'topic',500),left(coalesce(v_opp->>'whyNow',''),1500),left(coalesce(v_opp->>'audience',''),300),left(coalesce(v_opp->>'recommendedFormat',''),200),left(coalesce(v_opp->>'suggestedAngle',''),1500),v_priority,coalesce(v_sources,'[]'::jsonb))
      on conflict(tenant_id,business_date,topic_key) do update set why_now=excluded.why_now,audience=excluded.audience,recommended_format=excluded.recommended_format,suggested_angle=excluded.suggested_angle,priority=excluded.priority,sources=excluded.sources,run_id=excluded.run_id,updated_at=now();
      v_count:=v_count+1;
      if v_priority='high' then
        perform public.ai_ops_upsert_finding(p_tenant_id,p_run_id,'content_opportunities','content_opportunity:'||v_key,left('Content opportunity: '||(v_opp->>'topic'),300),v_priority,left(coalesce(v_opp->>'whyNow',''),2000),left(coalesce(v_opp->>'suggestedAngle',''),1000),'content_opportunity',v_key,null,null,jsonb_build_array(jsonb_build_object('sourceType','web_grounding','sourceRecordId',v_key,'sourceTimestamp',now(),'excerpt',left(coalesce(v_opp->>'whyNow',''),500),'evidenceHash',md5(coalesce(v_sources::text,'')||v_key))));
      end if;
    end loop;
  end loop;
  return jsonb_build_object('opportunitiesIngested',v_count);
end;$function$;

insert into private.ai_ops_flags(tenant_id,flag_name,enabled) values('00000000-0000-0000-0000-000000000001','content_opportunities_ai_enabled',true) on conflict(tenant_id,flag_name) do update set enabled=excluded.enabled,updated_at=now();