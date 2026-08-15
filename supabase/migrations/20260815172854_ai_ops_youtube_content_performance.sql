create table if not exists public.ai_operations_youtube_video_metrics (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  channel_id text not null,
  video_id text not null,
  video_title text,
  initiative text,
  published_at timestamptz,
  view_count bigint,
  like_count bigint,
  comment_count bigint,
  subscriber_count bigint,
  snapshot_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (tenant_id,video_id,snapshot_at)
);
alter table public.ai_operations_youtube_video_metrics enable row level security;
drop policy if exists "AI Ops video metrics are admin readable" on public.ai_operations_youtube_video_metrics;
create policy "AI Ops video metrics are admin readable" on public.ai_operations_youtube_video_metrics for select to authenticated using (private.ai_ops_is_admin_of(tenant_id));
drop policy if exists "AI Ops video metrics are worker managed" on public.ai_operations_youtube_video_metrics;
create policy "AI Ops video metrics are worker managed" on public.ai_operations_youtube_video_metrics for all to service_role using (true) with check (true);
create index if not exists ai_ops_youtube_video_metrics_lookup_idx on public.ai_operations_youtube_video_metrics(tenant_id,video_id,snapshot_at desc);

create or replace function public.ai_ops_upsert_youtube_video_metric(
 p_tenant_id uuid,p_channel_id text,p_video_id text,p_video_title text,p_initiative text,p_published_at timestamptz,p_view_count bigint,p_like_count bigint,p_comment_count bigint,p_subscriber_count bigint,p_snapshot_at timestamptz default now()
) returns uuid language plpgsql security definer set search_path to '' as $function$
declare v_id uuid;
begin
 if not private.valorwell_is_service_role() then raise exception 'AI Operations worker functions require the service role.' using errcode='42501'; end if;
 insert into public.ai_operations_youtube_video_metrics(tenant_id,channel_id,video_id,video_title,initiative,published_at,view_count,like_count,comment_count,subscriber_count,snapshot_at)
 values(p_tenant_id,p_channel_id,p_video_id,p_video_title,p_initiative,p_published_at,p_view_count,p_like_count,p_comment_count,p_subscriber_count,coalesce(p_snapshot_at,now())) returning id into v_id;
 return v_id;
end;$function$;

create or replace function public.ai_ops_build_content_performance_batches(p_tenant_id uuid,p_run_id uuid,p_cutoff_at timestamptz default now(),p_batch_size integer default 6) returns jsonb
language plpgsql security definer set search_path to '' as $function$
declare v_row record;v_entities jsonb:='[]'::jsonb;v_payload jsonb;v_signals text[];v_key text;v_batch int:=0;v_seen int:=0;v_queued int:=0;v_batch_size int:=least(greatest(coalesce(p_batch_size,6),3),8);v_metrics int;
begin
 if not private.valorwell_is_service_role() then raise exception 'AI Operations worker functions require the service role.' using errcode='42501';end if;
 select count(*) into v_metrics from public.ai_operations_youtube_video_metrics where tenant_id=p_tenant_id;
 if v_metrics=0 then return jsonb_build_object('sourceAvailable',false,'unavailableReason','youtube_video_metrics_not_collected','sourceItemsTotal',0,'itemsQueued',0,'batchesQueued',0,'cutoffAt',p_cutoff_at);end if;
 for v_row in
  with latest as (
    select distinct on(video_id) * from public.ai_operations_youtube_video_metrics where tenant_id=p_tenant_id order by video_id,snapshot_at desc
  ), prior as (
    select l.video_id,
      (select m.view_count from public.ai_operations_youtube_video_metrics m where m.tenant_id=p_tenant_id and m.video_id=l.video_id and m.snapshot_at<=l.snapshot_at-interval '24 hours' order by m.snapshot_at desc limit 1) prior_views,
      (select m.like_count from public.ai_operations_youtube_video_metrics m where m.tenant_id=p_tenant_id and m.video_id=l.video_id and m.snapshot_at<=l.snapshot_at-interval '24 hours' order by m.snapshot_at desc limit 1) prior_likes,
      (select m.comment_count from public.ai_operations_youtube_video_metrics m where m.tenant_id=p_tenant_id and m.video_id=l.video_id and m.snapshot_at<=l.snapshot_at-interval '24 hours' order by m.snapshot_at desc limit 1) prior_comments
    from latest l
  )
  select l.*,p.prior_views,p.prior_likes,p.prior_comments,
   (select count(*)::int from public.ai_operations_youtube_comments c where c.tenant_id=p_tenant_id and c.video_id=l.video_id and c.published_at>=p_cutoff_at-interval '7 days') recent_comments,
   (select count(*)::int from public.ai_operations_youtube_comments c where c.tenant_id=p_tenant_id and c.video_id=l.video_id and c.classification in ('question','support_request') and c.published_at>=p_cutoff_at-interval '30 days') substantive_comments
  from latest l join prior p using(video_id)
  where l.published_at is null or l.published_at>=p_cutoff_at-interval '90 days'
  order by l.published_at desc nulls last limit 50
 loop
  v_seen:=v_seen+1;v_signals:='{}'::text[];
  if v_row.prior_views is not null and v_row.view_count is not null and v_row.view_count-v_row.prior_views>0 then v_signals:=array_append(v_signals,'viewsGrowing');end if;
  if v_row.substantive_comments>0 then v_signals:=array_append(v_signals,'substantiveAudienceQuestions');end if;
  if v_row.comment_count is not null and v_row.view_count is not null and v_row.view_count>0 and v_row.comment_count::numeric/v_row.view_count>=0.01 then v_signals:=array_append(v_signals,'highCommentRate');end if;
  v_key:='cp'||left(md5(v_row.video_id||p_run_id::text),12);
  v_payload:=jsonb_build_object('entityKey',v_key,'initiative',v_row.initiative,'videoTitle',left(coalesce(v_row.video_title,''),300),'ageDays',case when v_row.published_at is null then null else floor(extract(epoch from(p_cutoff_at-v_row.published_at))/86400)::int end,'viewCount',v_row.view_count,'likeCount',v_row.like_count,'commentCount',v_row.comment_count,'subscriberCount',v_row.subscriber_count,'viewsDeltaFromPriorSnapshot',case when v_row.prior_views is null then null else v_row.view_count-v_row.prior_views end,'likesDeltaFromPriorSnapshot',case when v_row.prior_likes is null then null else v_row.like_count-v_row.prior_likes end,'commentsDeltaFromPriorSnapshot',case when v_row.prior_comments is null then null else v_row.comment_count-v_row.prior_comments end,'recentComments7d',v_row.recent_comments,'substantiveComments30d',v_row.substantive_comments,'derivedSignals',to_jsonb(v_signals),'sourceTimestamp',v_row.snapshot_at);
  insert into private.ai_ops_snapshots(tenant_id,entity_type,entity_id,snapshot_type,snapshot_hash,evaluation_hash,cutoff_at,payload,expires_at) values(p_tenant_id,'youtube_video',v_row.video_id,'content_performance:'||p_run_id::text,v_key,md5((v_payload-'entityKey')::text),p_cutoff_at,v_payload,now()+interval '30 days');
  v_entities:=v_entities||v_payload;v_queued:=v_queued+1;
  if jsonb_array_length(v_entities)>=v_batch_size then v_batch:=v_batch+1;perform public.ai_ops_enqueue_work(p_tenant_id,p_run_id,'content_performance','content_performance:'||p_run_id::text||':'||v_batch,'content_performance_review',jsonb_build_object('entities',v_entities),'1','1',85,'gemini-2.5-pro','{}'::uuid[]);v_entities:='[]'::jsonb;end if;
 end loop;
 if jsonb_array_length(v_entities)>0 then v_batch:=v_batch+1;perform public.ai_ops_enqueue_work(p_tenant_id,p_run_id,'content_performance','content_performance:'||p_run_id::text||':'||v_batch,'content_performance_review',jsonb_build_object('entities',v_entities),'1','1',85,'gemini-2.5-pro','{}'::uuid[]);end if;
 return jsonb_build_object('sourceAvailable',true,'sourceItemsTotal',v_seen,'itemsQueued',v_queued,'batchesQueued',v_batch,'cutoffAt',p_cutoff_at);
end;$function$;
create or replace function public.ai_ops_ingest_content_performance_results(p_tenant_id uuid,p_run_id uuid) returns jsonb language sql security definer set search_path to '' as $$select public.ai_ops_ingest_generic_results(p_tenant_id,p_run_id,'content_performance'::public.ai_ops_module_enum);$$;
insert into private.ai_ops_flags(tenant_id,flag_name,enabled) values('00000000-0000-0000-0000-000000000001','content_performance_ai_enabled',true) on conflict(tenant_id,flag_name) do update set enabled=excluded.enabled,updated_at=now();