alter table public.ai_operations_content_opportunities
  add column if not exists urgency text not null default 'this_week',
  add column if not exists why_fit text;
do $$ begin
  alter table public.ai_operations_content_opportunities
    add constraint ai_operations_content_opportunities_urgency_check
    check (urgency in ('today','this_week','evergreen'));
exception when duplicate_object then null; end $$;

alter table public.ai_operations_bty_briefs
  add column if not exists source_hash text;

alter table public.relationship_meetings
  add column if not exists transcript_text text,
  add column if not exists transcript_source text,
  add column if not exists transcript_captured_at timestamptz;

create index if not exists relationship_meetings_transcript_idx
  on public.relationship_meetings(tenant_id, ends_at desc)
  where transcript_text is not null;

create or replace function public.crm_record_bty_interview_transcript(
  p_meeting_id uuid,
  p_transcript text,
  p_source text default 'manual'
) returns jsonb
language plpgsql security definer set search_path to '' as $function$
declare v_tenant uuid; v_len int;
begin
  select tenant_id into v_tenant from public.relationship_meetings where id = p_meeting_id;
  if v_tenant is null then raise exception 'Unknown meeting.' using errcode = 'P0002'; end if;
  if not exists (
    select 1 from public.crm_user_capabilities c
    where c.profile_id = (select auth.uid()) and c.tenant_id = v_tenant
      and c.crm_role in ('crm_admin','crm_operator')
  ) then
    raise exception 'You do not have permission to record interview transcripts.' using errcode = '42501';
  end if;
  v_len := length(coalesce(p_transcript, ''));
  if v_len < 200 then raise exception 'A transcript must contain the actual interview text.' using errcode = '22023'; end if;

  update public.relationship_meetings
     set transcript_text = p_transcript,
         transcript_source = coalesce(nullif(p_source, ''), 'manual'),
         transcript_captured_at = now(),
         updated_at = now()
   where id = p_meeting_id;

  return jsonb_build_object('meetingId', p_meeting_id, 'characters', v_len, 'capturedAt', now());
end;$function$;

grant execute on function public.crm_record_bty_interview_transcript(uuid, text, text) to authenticated;

create or replace function public.ai_ops_build_content_opportunity_input(
  p_tenant_id uuid, p_run_id uuid, p_cutoff_at timestamptz default now()
) returns jsonb
language plpgsql security definer set search_path to '' as $function$
declare v_date date; v_payload jsonb; v_recent jsonb; v_questions jsonb; v_bty jsonb;
begin
  if not private.valorwell_is_service_role() then raise exception 'AI Operations worker functions require the service role.' using errcode='42501'; end if;
  select business_date into v_date from public.ai_operations_runs where id=p_run_id and tenant_id=p_tenant_id;
  if v_date is null then raise exception 'Unknown AI Operations run.' using errcode='P0002'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('topic', topic, 'businessDate', business_date, 'status', status) order by business_date desc), '[]'::jsonb)
    into v_recent
  from public.ai_operations_content_opportunities
  where tenant_id = p_tenant_id and business_date >= v_date - 21;

  select coalesce(jsonb_agg(jsonb_build_object('question', left(coalesce(comment_text,''), 400), 'videoTitle', video_title) order by published_at desc), '[]'::jsonb)
    into v_questions
  from (
    select comment_text, video_title, published_at
    from public.ai_operations_youtube_comments
    where tenant_id = p_tenant_id
      and coalesce(classification,'') in ('question','support_request')
      and published_at >= p_cutoff_at - interval '30 days'
    order by published_at desc limit 25
  ) q;

  select coalesce(jsonb_agg(jsonb_build_object('organization', o.name, 'startsAt', m.starts_at) order by m.starts_at), '[]'::jsonb)
    into v_bty
  from public.relationship_meetings m
  join public.relationship_organizations o on o.id = m.organization_id and o.tenant_id = m.tenant_id
  where m.tenant_id = p_tenant_id
    and m.starts_at between p_cutoff_at - interval '14 days' and p_cutoff_at + interval '30 days'
    and coalesce(m.event_status,'') not in ('cancelled','deleted');

  v_payload := jsonb_build_object(
    'businessDate', v_date,
    'organization', 'ValorWell',
    'missionContext', 'Veteran and military-family mental health access, practical care navigation, nonprofit impact, community partnerships, and Beyond The Yellow stories about organizations doing concrete work.',
    'audiences', jsonb_build_array('veterans','military families','mental health clinicians','donors','community partners'),
    'searchWindow', 'Prefer developments from the last 72 hours; use older context only when needed to explain a current development.',
    'maxOpportunities', 5,
    'urgencyValues', jsonb_build_array('today','this_week','evergreen'),
    'requirements', jsonb_build_array(
      'Return the best 3-5 opportunities only, or none if nothing is genuinely relevant',
      'Every opportunity must have a concrete reason to publish now',
      'Explain why ValorWell specifically has standing to speak about it',
      'Do not invent urgency and do not repeat a topic already listed in recentOpportunities',
      'Avoid partisan advocacy',
      'Return source-backed opportunities only'),
    'recentOpportunities', v_recent,
    'recentAudienceQuestions', v_questions,
    'btyInterviewContext', v_bty,
    'cutoffAt', p_cutoff_at
  );

  perform public.ai_ops_enqueue_work(
    p_tenant_id, p_run_id, 'content_opportunities', 'content_opportunities:'||p_run_id::text,
    'content_opportunity_review', v_payload, '2', '1', 80, 'gemini-2.5-flash', '{}'::uuid[]);
  return jsonb_build_object('sourceAvailable', true, 'sourceItemsTotal', 1, 'itemsQueued', 1, 'batchesQueued', 1,
    'recentTopicsSupplied', jsonb_array_length(v_recent), 'audienceQuestionsSupplied', jsonb_array_length(v_questions), 'cutoffAt', p_cutoff_at);
end;$function$;

create or replace function public.ai_ops_ingest_content_opportunities(p_tenant_id uuid, p_run_id uuid) returns jsonb
language plpgsql security definer set search_path to '' as $function$
declare v_item record; v_opp jsonb; v_date date; v_count int:=0; v_findings int:=0; v_key text;
        v_priority public.ai_ops_severity_enum; v_sources jsonb; v_urgency text;
begin
  if not private.valorwell_is_service_role() then raise exception 'AI Operations worker functions require the service role.' using errcode='42501'; end if;
  select business_date into v_date from public.ai_operations_runs where id=p_run_id and tenant_id=p_tenant_id;
  for v_item in
    select structured_result, token_usage from private.ai_ops_work_items
    where tenant_id=p_tenant_id and run_id=p_run_id and module='content_opportunities'
      and work_type='content_opportunity_review' and status='completed'
  loop
    for v_opp in
      select value from jsonb_array_elements(coalesce(v_item.structured_result->'opportunities','[]'::jsonb)) limit 5
    loop
      if coalesce(v_opp->>'topic','')='' then continue; end if;
      v_key := md5(lower(trim(v_opp->>'topic')));
      v_priority := case lower(coalesce(v_opp->>'priority','medium'))
        when 'high' then 'high'::public.ai_ops_severity_enum
        when 'low' then 'low'::public.ai_ops_severity_enum
        else 'medium'::public.ai_ops_severity_enum end;
      v_urgency := case lower(coalesce(v_opp->>'urgency','this_week'))
        when 'today' then 'today' when 'evergreen' then 'evergreen' else 'this_week' end;
      v_sources := coalesce(v_opp->'sources', v_item.token_usage->'groundingSources', '[]'::jsonb);
      if jsonb_typeof(v_sources) <> 'array' or jsonb_array_length(v_sources) = 0 then continue; end if;

      insert into public.ai_operations_content_opportunities(
        tenant_id,run_id,business_date,topic_key,topic,why_now,why_fit,audience,recommended_format,suggested_angle,priority,urgency,sources)
      values(p_tenant_id,p_run_id,v_date,v_key,left(v_opp->>'topic',500),left(coalesce(v_opp->>'whyNow',''),1500),
        left(coalesce(v_opp->>'whyValorWell',''),1500),left(coalesce(v_opp->>'audience',''),300),
        left(coalesce(v_opp->>'recommendedFormat',''),200),left(coalesce(v_opp->>'suggestedAngle',''),1500),
        v_priority,v_urgency,v_sources)
      on conflict(tenant_id,business_date,topic_key) do update set
        why_now=excluded.why_now, why_fit=excluded.why_fit, audience=excluded.audience,
        recommended_format=excluded.recommended_format, suggested_angle=excluded.suggested_angle,
        priority=excluded.priority, urgency=excluded.urgency, sources=excluded.sources,
        run_id=excluded.run_id, updated_at=now();
      v_count := v_count + 1;

      if v_priority = 'high' or v_urgency = 'today' then
        perform public.ai_ops_upsert_finding(
          p_tenant_id, p_run_id, 'content_opportunities', 'content_opportunity:'||v_key,
          left('Content opportunity: '||(v_opp->>'topic'),300),
          case when v_urgency='today' then 'high'::public.ai_ops_severity_enum else v_priority end,
          left(coalesce(v_opp->>'whyNow','')||case when coalesce(v_opp->>'whyValorWell','')='' then '' else ' | Fit: '||(v_opp->>'whyValorWell') end,2000),
          left(coalesce(v_opp->>'suggestedAngle',''),1000),
          'content_opportunity', v_key, null, null,
          jsonb_build_array(jsonb_build_object('sourceType','web_grounding','sourceRecordId',v_key,'sourceTimestamp',now(),
            'excerpt',left(coalesce(v_opp->>'whyNow',''),500),'evidenceHash',md5(coalesce(v_sources::text,'')||v_key))));
        v_findings := v_findings + 1;
      end if;
    end loop;
  end loop;
  return jsonb_build_object('opportunitiesIngested', v_count, 'findings', v_findings);
end;$function$;

create or replace function public.ai_ops_build_content_performance_batches(
  p_tenant_id uuid, p_run_id uuid, p_cutoff_at timestamptz default now(), p_batch_size integer default 6
) returns jsonb
language plpgsql security definer set search_path to '' as $function$
declare v_row record; v_entities jsonb:='[]'::jsonb; v_payload jsonb; v_signals text[]; v_key text;
        v_batch int:=0; v_seen int:=0; v_queued int:=0; v_batch_size int:=least(greatest(coalesce(p_batch_size,6),3),8);
        v_metrics int; v_median numeric; v_median_vpd numeric; v_vpd numeric; v_low_sample boolean;
begin
  if not private.valorwell_is_service_role() then raise exception 'AI Operations worker functions require the service role.' using errcode='42501'; end if;
  select count(*) into v_metrics from public.ai_operations_youtube_video_metrics where tenant_id=p_tenant_id;
  if v_metrics=0 then
    return jsonb_build_object('sourceAvailable',false,'unavailableReason','youtube_video_metrics_not_collected','sourceItemsTotal',0,'itemsQueued',0,'batchesQueued',0,'cutoffAt',p_cutoff_at);
  end if;

  with latest as (
    select distinct on (video_id) * from public.ai_operations_youtube_video_metrics
    where tenant_id=p_tenant_id order by video_id, snapshot_at desc
  )
  select
    percentile_cont(0.5) within group (order by view_count::numeric),
    percentile_cont(0.5) within group (order by case when published_at is null then null
      else view_count::numeric / greatest(extract(epoch from (p_cutoff_at - published_at))/86400, 1) end)
  into v_median, v_median_vpd
  from latest where view_count is not null;

  for v_row in
    with latest as (
      select distinct on (video_id) * from public.ai_operations_youtube_video_metrics
      where tenant_id=p_tenant_id order by video_id, snapshot_at desc
    ), prior as (
      select l.video_id,
        (select m.view_count from public.ai_operations_youtube_video_metrics m where m.tenant_id=p_tenant_id and m.video_id=l.video_id and m.snapshot_at<=l.snapshot_at-interval '7 days' order by m.snapshot_at desc limit 1) prior_views_7d,
        (select m.view_count from public.ai_operations_youtube_video_metrics m where m.tenant_id=p_tenant_id and m.video_id=l.video_id and m.snapshot_at<=l.snapshot_at-interval '24 hours' order by m.snapshot_at desc limit 1) prior_views,
        (select m.like_count from public.ai_operations_youtube_video_metrics m where m.tenant_id=p_tenant_id and m.video_id=l.video_id and m.snapshot_at<=l.snapshot_at-interval '24 hours' order by m.snapshot_at desc limit 1) prior_likes,
        (select m.comment_count from public.ai_operations_youtube_video_metrics m where m.tenant_id=p_tenant_id and m.video_id=l.video_id and m.snapshot_at<=l.snapshot_at-interval '24 hours' order by m.snapshot_at desc limit 1) prior_comments,
        (select count(*)::int from public.ai_operations_youtube_video_metrics m where m.tenant_id=p_tenant_id and m.video_id=l.video_id) snapshot_count
      from latest l
    )
    select l.*, p.prior_views, p.prior_likes, p.prior_comments, p.prior_views_7d, p.snapshot_count,
      (select count(*)::int from public.ai_operations_youtube_comments c where c.tenant_id=p_tenant_id and c.video_id=l.video_id and c.published_at>=p_cutoff_at-interval '7 days') recent_comments,
      (select count(*)::int from public.ai_operations_youtube_comments c where c.tenant_id=p_tenant_id and c.video_id=l.video_id and c.classification in ('question','support_request') and c.published_at>=p_cutoff_at-interval '30 days') substantive_comments
    from latest l join prior p using(video_id)
    where l.published_at is null or l.published_at>=p_cutoff_at-interval '180 days'
    order by l.published_at desc nulls last limit 50
  loop
    v_seen := v_seen + 1; v_signals := '{}'::text[];
    v_vpd := case when v_row.published_at is null or v_row.view_count is null then null
      else v_row.view_count::numeric / greatest(extract(epoch from (p_cutoff_at - v_row.published_at))/86400, 1) end;
    v_low_sample := coalesce(v_row.view_count,0) < 100 or coalesce(v_row.snapshot_count,0) < 2;

    if v_row.prior_views is not null and v_row.view_count is not null and v_row.view_count-v_row.prior_views>0 then v_signals:=array_append(v_signals,'viewsGrowing'); end if;
    if v_row.prior_views_7d is not null and v_row.view_count is not null and v_row.view_count-v_row.prior_views_7d<=0 then v_signals:=array_append(v_signals,'viewsFlatOverSevenDays'); end if;
    if v_row.substantive_comments>0 then v_signals:=array_append(v_signals,'substantiveAudienceQuestions'); end if;
    if v_row.comment_count is not null and v_row.view_count is not null and v_row.view_count>0 and v_row.comment_count::numeric/v_row.view_count>=0.01 then v_signals:=array_append(v_signals,'highCommentRate'); end if;
    if v_median is not null and v_row.view_count is not null and v_median>0 and v_row.view_count >= v_median*1.5 then v_signals:=array_append(v_signals,'outperformsChannelMedian'); end if;
    if v_median is not null and v_row.view_count is not null and v_median>0 and v_row.view_count <= v_median*0.5 then v_signals:=array_append(v_signals,'underperformsChannelMedian'); end if;
    if v_median_vpd is not null and v_vpd is not null and v_median_vpd>0 and v_vpd >= v_median_vpd*1.5 then v_signals:=array_append(v_signals,'viewsPerDayAboveChannelPace'); end if;
    if v_low_sample then v_signals:=array_append(v_signals,'lowSampleSize'); end if;

    v_key := 'cp'||left(md5(v_row.video_id||p_run_id::text),12);
    v_payload := jsonb_build_object(
      'entityKey', v_key, 'initiative', v_row.initiative,
      'videoTitle', left(coalesce(v_row.video_title,''),300),
      'ageDays', case when v_row.published_at is null then null else floor(extract(epoch from (p_cutoff_at-v_row.published_at))/86400)::int end,
      'viewCount', v_row.view_count, 'likeCount', v_row.like_count, 'commentCount', v_row.comment_count,
      'subscriberCount', v_row.subscriber_count,
      'viewsPerDay', round(coalesce(v_vpd,0),2),
      'channelMedianViews', round(coalesce(v_median,0),2),
      'channelMedianViewsPerDay', round(coalesce(v_median_vpd,0),2),
      'viewsVsChannelMedianRatio', case when coalesce(v_median,0)=0 or v_row.view_count is null then null else round(v_row.view_count::numeric/v_median,2) end,
      'viewsDeltaFromPriorSnapshot', case when v_row.prior_views is null then null else v_row.view_count-v_row.prior_views end,
      'viewsDeltaLastSevenDays', case when v_row.prior_views_7d is null then null else v_row.view_count-v_row.prior_views_7d end,
      'likesDeltaFromPriorSnapshot', case when v_row.prior_likes is null then null else v_row.like_count-v_row.prior_likes end,
      'commentsDeltaFromPriorSnapshot', case when v_row.prior_comments is null then null else v_row.comment_count-v_row.prior_comments end,
      'engagementRate', case when coalesce(v_row.view_count,0)=0 then null else round((coalesce(v_row.like_count,0)+coalesce(v_row.comment_count,0))::numeric/v_row.view_count,4) end,
      'recentComments7d', v_row.recent_comments, 'substantiveComments30d', v_row.substantive_comments,
      'snapshotCount', v_row.snapshot_count, 'lowSampleSize', v_low_sample,
      'derivedSignals', to_jsonb(v_signals), 'sourceTimestamp', v_row.snapshot_at);

    insert into private.ai_ops_snapshots(tenant_id,entity_type,entity_id,snapshot_type,snapshot_hash,evaluation_hash,cutoff_at,payload,expires_at)
    values(p_tenant_id,'youtube_video',v_row.video_id,'content_performance:'||p_run_id::text,v_key,md5((v_payload-'entityKey')::text),p_cutoff_at,v_payload,now()+interval '30 days');

    v_entities := v_entities || v_payload; v_queued := v_queued + 1;
    if jsonb_array_length(v_entities) >= v_batch_size then
      v_batch := v_batch + 1;
      perform public.ai_ops_enqueue_work(p_tenant_id,p_run_id,'content_performance','content_performance:'||p_run_id::text||':'||v_batch,'content_performance_review',jsonb_build_object('entities',v_entities),'2','1',85,'gemini-2.5-flash','{}'::uuid[]);
      v_entities := '[]'::jsonb;
    end if;
  end loop;
  if jsonb_array_length(v_entities) > 0 then
    v_batch := v_batch + 1;
    perform public.ai_ops_enqueue_work(p_tenant_id,p_run_id,'content_performance','content_performance:'||p_run_id::text||':'||v_batch,'content_performance_review',jsonb_build_object('entities',v_entities),'2','1',85,'gemini-2.5-flash','{}'::uuid[]);
  end if;
  return jsonb_build_object('sourceAvailable',true,'sourceItemsTotal',v_seen,'itemsQueued',v_queued,'batchesQueued',v_batch,
    'channelMedianViews',round(coalesce(v_median,0),2),'cutoffAt',p_cutoff_at);
end;$function$;

create or replace function public.ai_ops_build_bty_interview_prep_batches(
  p_tenant_id uuid, p_run_id uuid, p_cutoff_at timestamptz default now()
) returns jsonb
language plpgsql security definer set search_path to '' as $function$
declare v_row record; v_payload jsonb; v_key text; v_hash text; v_queued int:=0; v_seen int:=0; v_current int:=0;
begin
  if not private.valorwell_is_service_role() then raise exception 'AI Operations worker functions require the service role.' using errcode='42501'; end if;
  for v_row in
    select m.id, m.organization_id, m.contact_id, m.opportunity_id, m.purpose, m.starts_at, m.ends_at, m.event_status,
      o.name organization_name, o.website, o.organization_kind, o.veteran_affiliated, o.relationship_stage, o.headquarters_state,
      c.first_name, c.last_name, c.preferred_name, c.veteran_affiliation,
      ro.status opportunity_status, ro.cause_area, ro.next_action, ro.qualification,
      (select jsonb_agg(jsonb_build_object('occurredAt',i.occurred_at,'type',i.interaction_type,'summary',left(coalesce(i.summary,''),1200)) order by i.occurred_at desc)
       from (select * from public.relationship_interactions ri
             where ri.tenant_id=p_tenant_id
               and (ri.organization_id=m.organization_id
                    or (m.contact_id is not null and ri.contact_id=m.contact_id)
                    or (m.opportunity_id is not null and ri.opportunity_id=m.opportunity_id))
             order by ri.occurred_at desc limit 10) i) recent_interactions
    from public.relationship_meetings m
    join public.relationship_organizations o on o.id=m.organization_id and o.tenant_id=m.tenant_id
    left join public.relationship_contacts c on c.id=m.contact_id and c.tenant_id=m.tenant_id
    left join public.relationship_opportunities ro on ro.id=m.opportunity_id and ro.tenant_id=m.tenant_id
    where m.tenant_id=p_tenant_id
      and exists (select 1 from public.relationship_organization_roles r
                  where r.tenant_id=p_tenant_id and r.organization_id=m.organization_id and r.role_code='bty_nominee')
      and m.starts_at between p_cutoff_at and p_cutoff_at + interval '14 days'
      and coalesce(m.event_status,'') not in ('cancelled','deleted')
    order by m.starts_at
  loop
    v_seen := v_seen + 1;
    v_key := 'btyprep'||left(md5(v_row.id::text||p_run_id::text),12);
    v_payload := jsonb_build_object(
      'entityKey', v_key, 'meetingId', v_row.id, 'meetingPurpose', v_row.purpose,
      'startsAt', v_row.starts_at, 'endsAt', v_row.ends_at, 'eventStatus', v_row.event_status,
      'daysUntilInterview', greatest(floor(extract(epoch from (v_row.starts_at - p_cutoff_at))/86400)::int, 0),
      'organization', jsonb_build_object('id',v_row.organization_id,'name',v_row.organization_name,'website',v_row.website,
        'kind',v_row.organization_kind,'veteranAffiliated',v_row.veteran_affiliated,'relationshipStage',v_row.relationship_stage,
        'headquartersState',v_row.headquarters_state),
      'contact', case when v_row.contact_id is null then null else jsonb_build_object('id',v_row.contact_id,
        'name',trim(concat_ws(' ',coalesce(v_row.preferred_name,v_row.first_name),v_row.last_name)),
        'veteranAffiliation',v_row.veteran_affiliation) end,
      'opportunity', case when v_row.opportunity_id is null then null else jsonb_build_object('id',v_row.opportunity_id,
        'status',v_row.opportunity_status,'causeArea',v_row.cause_area,'nextAction',v_row.next_action,'qualification',v_row.qualification) end,
      'recentInteractions', coalesce(v_row.recent_interactions,'[]'::jsonb),
      'sourceTimestamp', v_row.starts_at);
    v_hash := md5((v_payload - 'entityKey')::text);

    if exists (select 1 from public.ai_operations_bty_briefs b
               where b.tenant_id=p_tenant_id and b.meeting_id=v_row.id and b.brief_type='prep'
                 and b.source_hash = v_hash) then
      v_current := v_current + 1; continue;
    end if;

    insert into private.ai_ops_snapshots(tenant_id,entity_type,entity_id,snapshot_type,snapshot_hash,evaluation_hash,cutoff_at,payload,expires_at)
    values(p_tenant_id,'relationship_meeting',v_row.id::text,'bty_intelligence:'||p_run_id::text,v_key,v_hash,p_cutoff_at,v_payload,now()+interval '30 days');
    perform public.ai_ops_enqueue_work(p_tenant_id,p_run_id,'bty_intelligence','bty_prep:'||v_row.id::text||':'||v_hash,
      'bty_interview_prep', jsonb_build_object('entities',jsonb_build_array(v_payload)),'2','1',65,'gemini-2.5-flash','{}'::uuid[]);
    v_queued := v_queued + 1;
  end loop;
  return jsonb_build_object('upcomingInterviews',v_seen,'prepItemsQueued',v_queued,'briefsAlreadyCurrent',v_current);
end;$function$;

create or replace function public.ai_ops_build_bty_post_interview_batches(
  p_tenant_id uuid, p_run_id uuid, p_cutoff_at timestamptz default now()
) returns jsonb
language plpgsql security definer set search_path to '' as $function$
declare v_row record; v_payload jsonb; v_key text; v_hash text; v_queued int:=0; v_seen int:=0; v_current int:=0; v_no_source int:=0;
begin
  if not private.valorwell_is_service_role() then raise exception 'AI Operations worker functions require the service role.' using errcode='42501'; end if;
  for v_row in
    select m.id, m.organization_id, m.contact_id, m.opportunity_id, m.purpose, m.starts_at, m.ends_at,
      m.transcript_text, m.transcript_source, m.transcript_captured_at,
      o.name organization_name, o.website, o.organization_kind, o.relationship_stage,
      c.first_name, c.last_name, c.preferred_name,
      ro.status opportunity_status, ro.next_action
    from public.relationship_meetings m
    join public.relationship_organizations o on o.id=m.organization_id and o.tenant_id=m.tenant_id
    left join public.relationship_contacts c on c.id=m.contact_id and c.tenant_id=m.tenant_id
    left join public.relationship_opportunities ro on ro.id=m.opportunity_id and ro.tenant_id=m.tenant_id
    where m.tenant_id=p_tenant_id
      and exists (select 1 from public.relationship_organization_roles r
                  where r.tenant_id=p_tenant_id and r.organization_id=m.organization_id and r.role_code='bty_nominee')
      and m.ends_at between p_cutoff_at - interval '60 days' and p_cutoff_at
      and coalesce(m.event_status,'') not in ('cancelled','deleted')
    order by m.ends_at desc limit 25
  loop
    v_seen := v_seen + 1;
    if coalesce(length(v_row.transcript_text),0) < 200 then v_no_source := v_no_source + 1; continue; end if;
    v_key := 'btypost'||left(md5(v_row.id::text||p_run_id::text),12);
    v_payload := jsonb_build_object(
      'entityKey', v_key, 'meetingId', v_row.id, 'meetingPurpose', v_row.purpose,
      'startsAt', v_row.starts_at, 'endsAt', v_row.ends_at,
      'organization', jsonb_build_object('id',v_row.organization_id,'name',v_row.organization_name,'website',v_row.website,
        'kind',v_row.organization_kind,'relationshipStage',v_row.relationship_stage),
      'contact', case when v_row.contact_id is null then null else jsonb_build_object('id',v_row.contact_id,
        'name',trim(concat_ws(' ',coalesce(v_row.preferred_name,v_row.first_name),v_row.last_name))) end,
      'opportunity', case when v_row.opportunity_id is null then null else jsonb_build_object('id',v_row.opportunity_id,
        'status',v_row.opportunity_status,'nextAction',v_row.next_action) end,
      'transcriptSource', v_row.transcript_source,
      'transcriptCapturedAt', v_row.transcript_captured_at,
      'transcriptCharacters', length(v_row.transcript_text),
      'transcript', left(v_row.transcript_text, 200000),
      'sourceTimestamp', v_row.ends_at);
    v_hash := md5(coalesce(v_row.transcript_text,'')||v_row.id::text);

    if exists (select 1 from public.ai_operations_bty_briefs b
               where b.tenant_id=p_tenant_id and b.meeting_id=v_row.id and b.brief_type='post_interview'
                 and b.source_hash = v_hash) then
      v_current := v_current + 1; continue;
    end if;

    insert into private.ai_ops_snapshots(tenant_id,entity_type,entity_id,snapshot_type,snapshot_hash,evaluation_hash,cutoff_at,payload,expires_at)
    values(p_tenant_id,'relationship_meeting',v_row.id::text,'bty_intelligence:'||p_run_id::text,v_key,v_hash,p_cutoff_at,v_payload,now()+interval '30 days');
    perform public.ai_ops_enqueue_work(p_tenant_id,p_run_id,'bty_intelligence','bty_post:'||v_row.id::text||':'||v_hash,
      'bty_post_interview_review', jsonb_build_object('entities',jsonb_build_array(v_payload)),'2','1',65,'gemini-2.5-flash','{}'::uuid[]);
    v_queued := v_queued + 1;
  end loop;
  return jsonb_build_object('completedInterviews',v_seen,'postInterviewItemsQueued',v_queued,
    'briefsAlreadyCurrent',v_current,'awaitingTranscript',v_no_source);
end;$function$;

create or replace function public.ai_ops_build_bty_intelligence_batches(
  p_tenant_id uuid, p_run_id uuid, p_cutoff_at timestamptz default now()
) returns jsonb
language plpgsql security definer set search_path to '' as $function$
declare v_prep jsonb; v_post jsonb; v_queued int;
begin
  if not private.valorwell_is_service_role() then raise exception 'AI Operations worker functions require the service role.' using errcode='42501'; end if;
  v_prep := public.ai_ops_build_bty_interview_prep_batches(p_tenant_id,p_run_id,p_cutoff_at);
  v_post := public.ai_ops_build_bty_post_interview_batches(p_tenant_id,p_run_id,p_cutoff_at);
  v_queued := coalesce((v_prep->>'prepItemsQueued')::int,0) + coalesce((v_post->>'postInterviewItemsQueued')::int,0);
  return jsonb_build_object(
    'sourceAvailable', coalesce((v_prep->>'upcomingInterviews')::int,0) + coalesce((v_post->>'completedInterviews')::int,0) > 0,
    'sourceItemsTotal', coalesce((v_prep->>'upcomingInterviews')::int,0) + coalesce((v_post->>'completedInterviews')::int,0),
    'itemsQueued', v_queued, 'batchesQueued', v_queued,
    'prep', v_prep, 'postInterview', v_post, 'cutoffAt', p_cutoff_at);
end;$function$;

create or replace function public.ai_ops_ingest_bty_intelligence_results(p_tenant_id uuid, p_run_id uuid) returns jsonb
language plpgsql security definer set search_path to '' as $function$
declare v_item record; v_result jsonb; v_snap record; v_date date; v_count int:=0; v_type text;
        v_followup jsonb; v_findings int:=0; v_key text; v_sev public.ai_ops_severity_enum; v_org text; v_sufficient boolean;
begin
  if not private.valorwell_is_service_role() then raise exception 'AI Operations worker functions require the service role.' using errcode='42501'; end if;
  select business_date into v_date from public.ai_operations_runs where id=p_run_id and tenant_id=p_tenant_id;
  for v_item in
    select work_type, structured_result from private.ai_ops_work_items
    where tenant_id=p_tenant_id and run_id=p_run_id and module='bty_intelligence' and status='completed'
  loop
    v_type := case when v_item.work_type='bty_post_interview_review' then 'post_interview' else 'prep' end;
    for v_result in select value from jsonb_array_elements(coalesce(v_item.structured_result->'results','[]'::jsonb)) loop
      select entity_id, payload, evaluation_hash into v_snap
      from private.ai_ops_snapshots
      where tenant_id=p_tenant_id and snapshot_type='bty_intelligence:'||p_run_id::text and snapshot_hash=v_result->>'entityKey' limit 1;
      if v_snap.entity_id is null then continue; end if;
      v_sufficient := coalesce((v_result->>'sourceSufficient')::boolean, true);
      v_org := nullif(v_snap.payload#>>'{organization,id}','');

      insert into public.ai_operations_bty_briefs(tenant_id,run_id,meeting_id,organization_id,opportunity_id,contact_id,
        brief_type,business_date,source_sufficient,structured_result,source_hash)
      values(p_tenant_id,p_run_id,v_snap.entity_id::uuid,v_org::uuid,
        nullif(v_snap.payload#>>'{opportunity,id}','')::uuid, nullif(v_snap.payload#>>'{contact,id}','')::uuid,
        v_type, v_date, v_sufficient, v_result, v_snap.evaluation_hash)
      on conflict(tenant_id,meeting_id,brief_type,business_date) do update set
        structured_result=excluded.structured_result, source_sufficient=excluded.source_sufficient,
        source_hash=excluded.source_hash, run_id=excluded.run_id, updated_at=now();
      v_count := v_count + 1;

      if not v_sufficient then continue; end if;

      if v_type='prep' then
        v_key := md5(v_snap.entity_id||':prep');
        perform public.ai_ops_upsert_finding(p_tenant_id,p_run_id,'bty_intelligence','bty_prep:'||v_key,
          left('BTY interview prep ready: '||coalesce(v_snap.payload#>>'{organization,name}','Beyond The Yellow guest'),300),
          'medium'::public.ai_ops_severity_enum,
          left(coalesce(v_result->>'summary', v_result->>'guestSnapshot',''),2000),
          'Review the prep brief before the interview.',
          case when v_org is null then 'relationship_meeting' else 'relationship_organization' end,
          coalesce(v_org, v_snap.entity_id), nullif(v_result->>'confidence','')::numeric, null,
          jsonb_build_array(jsonb_build_object('sourceType','relationship_meeting','sourceRecordId',v_snap.entity_id,
            'sourceTimestamp',v_snap.payload->>'sourceTimestamp','excerpt',left(coalesce(v_result->>'whyFitBty',''),500),
            'evidenceHash',v_snap.evaluation_hash)));
        v_findings := v_findings + 1;
      else
        for v_followup in select value from jsonb_array_elements(coalesce(v_result->'followUps','[]'::jsonb)) loop
          if coalesce(v_followup->>'description','')='' then continue; end if;
          v_sev := case lower(coalesce(v_followup->>'severity','medium'))
            when 'high' then 'high'::public.ai_ops_severity_enum
            when 'critical' then 'high'::public.ai_ops_severity_enum
            when 'low' then 'low'::public.ai_ops_severity_enum
            else 'medium'::public.ai_ops_severity_enum end;
          v_key := md5(v_snap.entity_id||':'||lower(trim(v_followup->>'description')));
          perform public.ai_ops_upsert_finding(p_tenant_id,p_run_id,'bty_intelligence','bty_followup:'||v_key,
            left('BTY follow-up: '||(v_followup->>'description'),300), v_sev,
            left(coalesce(v_followup->>'context', v_result->>'summary',''),2000),
            left(coalesce(v_followup->>'recommendedAction', v_followup->>'description',''),1000),
            case when v_org is null then 'relationship_meeting' else 'relationship_organization' end,
            coalesce(v_org, v_snap.entity_id), null, null,
            jsonb_build_array(jsonb_build_object('sourceType','bty_interview_transcript','sourceRecordId',v_snap.entity_id,
              'sourceTimestamp',v_snap.payload->>'sourceTimestamp','excerpt',left(coalesce(v_followup->>'description',''),500),
              'evidenceHash',md5(v_followup::text))));
          v_findings := v_findings + 1;
        end loop;
      end if;
    end loop;
  end loop;
  return jsonb_build_object('briefsIngested',v_count,'findings',v_findings);
end;$function$;

insert into private.ai_ops_flags(tenant_id,flag_name,enabled)
values('00000000-0000-0000-0000-000000000001','bty_intelligence_ai_enabled',true)
on conflict(tenant_id,flag_name) do update set enabled=excluded.enabled, updated_at=now();