create or replace function public.ai_ops_build_content_opportunity_input(
  p_tenant_id uuid,
  p_run_id uuid,
  p_cutoff_at timestamp with time zone default now()
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_date date;
  v_payload jsonb;
  v_recent jsonb;
  v_questions jsonb;
  v_bty jsonb;
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode='42501';
  end if;

  select business_date into v_date
  from public.ai_operations_runs
  where id=p_run_id and tenant_id=p_tenant_id;
  if v_date is null then
    raise exception 'Unknown AI Operations run.' using errcode='P0002';
  end if;

  select coalesce(
    jsonb_agg(jsonb_build_object('topic', topic, 'businessDate', business_date, 'status', status) order by business_date desc),
    '[]'::jsonb
  ) into v_recent
  from public.ai_operations_content_opportunities
  where tenant_id = p_tenant_id and business_date >= v_date - 21;

  select coalesce(
    jsonb_agg(jsonb_build_object('question', left(coalesce(comment_text,''), 400), 'videoTitle', video_title) order by published_at desc),
    '[]'::jsonb
  ) into v_questions
  from (
    select comment_text, video_title, published_at
    from public.ai_operations_youtube_comments
    where tenant_id = p_tenant_id
      and coalesce(classification,'') in ('question','support_request')
      and published_at >= p_cutoff_at - interval '30 days'
    order by published_at desc
    limit 25
  ) q;

  select coalesce(
    jsonb_agg(jsonb_build_object('organization', o.name, 'startsAt', m.starts_at) order by m.starts_at),
    '[]'::jsonb
  ) into v_bty
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
    'searchWindow', 'Use YouTube Data API evidence from long-form videos published within the 24 hours before cutoffAt. Long-form means at least 8 minutes.',
    'maxOpportunities', 5,
    'urgencyValues', jsonb_build_array('today','this_week','evergreen'),
    'requirements', jsonb_build_array(
      'Return the best 3-5 opportunities only, or none if nothing is genuinely relevant',
      'Every opportunity must have a concrete reason to publish now based on supplied YouTube momentum',
      'Explain why ValorWell specifically has standing to speak about it',
      'Do not invent urgency and do not repeat a topic already listed in recentOpportunities',
      'Avoid partisan advocacy',
      'Treat source videos as trend signals, not content to copy',
      'Return source-backed opportunities using supplied YouTube video URLs only'
    ),
    'recentOpportunities', v_recent,
    'recentAudienceQuestions', v_questions,
    'btyInterviewContext', v_bty,
    'cutoffAt', p_cutoff_at
  );

  perform public.ai_ops_enqueue_work(
    p_tenant_id,
    p_run_id,
    'content_opportunities',
    'content_opportunities:'||p_run_id::text,
    'content_opportunity_review',
    v_payload,
    '3',
    '1',
    80,
    'gemini-3.6-flash',
    '{}'::uuid[]
  );

  return jsonb_build_object(
    'sourceAvailable', true,
    'sourceItemsTotal', 1,
    'itemsQueued', 1,
    'batchesQueued', 1,
    'recentTopicsSupplied', jsonb_array_length(v_recent),
    'audienceQuestionsSupplied', jsonb_array_length(v_questions),
    'cutoffAt', p_cutoff_at
  );
end;
$function$;
