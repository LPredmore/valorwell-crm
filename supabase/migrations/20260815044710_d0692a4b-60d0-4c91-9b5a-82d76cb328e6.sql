-- Communications QA: correct email reply evidence.
-- crm_email_messages.in_reply_to_message_id is an internal message UUID, not a provider id.
create or replace function public.ai_ops_build_communications_batches(
  p_tenant_id uuid,
  p_run_id uuid,
  p_cutoff_at timestamptz default now(),
  p_lookback_days integer default 7,
  p_batch_size integer default 6
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_batch_size integer := least(greatest(coalesce(p_batch_size, 6), 5), 8);
  v_since timestamptz := p_cutoff_at - make_interval(days => greatest(coalesce(p_lookback_days, 7), 1));
  v_row record;
  v_entities jsonb := '[]'::jsonb;
  v_batch_index integer := 0;
  v_seen integer := 0;
  v_answered integer := 0;
  v_unknown integer := 0;
  v_queued_items integer := 0;
  v_batches integer := 0;
  v_email integer := 0;
  v_portal integer := 0;
  v_sms integer := 0;
  v_entity_key text;
  v_payload jsonb;
  v_deadline timestamptz;
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode = '42501';
  end if;

  for v_row in
    select * from (
      -- EMAIL: reply evidence requires authoritative threading, never "some later email".
      select
        'email'::text as channel,
        m.id::text as source_id,
        m.client_id,
        coalesce(m.received_at, m.occurred_at, m.created_at) as received_at,
        left(coalesce(m.body_text, m.subject, ''), 1500) as excerpt,
        m.subject,
        case
          when exists (
            select 1 from public.crm_email_messages o
            where o.tenant_id = m.tenant_id
              and o.direction = 'outbound'
              and coalesce(o.sent_at, o.occurred_at) > coalesce(m.received_at, m.occurred_at, m.created_at)
              and (
                o.in_reply_to_message_id = m.id
                or (m.provider_thread_id is not null and o.provider_thread_id = m.provider_thread_id)
              )
          ) then 'answered'
          when m.provider_thread_id is null then 'unknown'
          else 'unanswered'
        end as response_state
      from public.crm_email_messages m
      where m.tenant_id = p_tenant_id
        and m.direction = 'inbound'
        and coalesce(m.received_at, m.occurred_at, m.created_at) between v_since and p_cutoff_at

      union all

      -- PORTAL: answered by a later staff message in the same client conversation.
      select
        'portal'::text as channel,
        pm.id::text as source_id,
        pm.client_id,
        pm.created_at as received_at,
        left(coalesce(pm.body, ''), 1500) as excerpt,
        null::text as subject,
        case
          when exists (
            select 1 from public.messages r
            where r.tenant_id = pm.tenant_id
              and r.client_id = pm.client_id
              and r.sender_type = 'staff'
              and r.created_at > pm.created_at
          ) then 'answered'
          when pm.client_id is null then 'unknown'
          else 'unanswered'
        end as response_state
      from public.messages pm
      where pm.tenant_id = p_tenant_id
        and pm.sender_type = 'client'
        and pm.created_at between v_since and p_cutoff_at

      union all

      -- SMS: answered only by recorded outbound SMS activity, never by email.
      select
        'sms'::text as channel,
        s.id::text as source_id,
        s.client_id,
        s.received_at,
        left(coalesce(s.message_body, ''), 1500) as excerpt,
        null::text as subject,
        case
          when s.client_id is null then 'unknown'
          when exists (
            select 1 from public.crm_activity_events a
            where a.tenant_id = s.tenant_id
              and a.client_id = s.client_id
              and a.event_type = 'sms_sent'
              and a.created_at > s.received_at
          ) then 'answered'
          else 'unanswered'
        end as response_state
      from public.crm_inbound_sms_logs s
      where s.tenant_id = p_tenant_id
        and s.received_at between v_since and p_cutoff_at
    ) inbound
    order by inbound.received_at
  loop
    v_seen := v_seen + 1;
    if v_row.channel = 'email' then v_email := v_email + 1;
    elsif v_row.channel = 'portal' then v_portal := v_portal + 1;
    else v_sms := v_sms + 1;
    end if;

    if v_row.response_state = 'answered' then
      v_answered := v_answered + 1;
      continue;
    end if;
    if v_row.response_state = 'unknown' then
      v_unknown := v_unknown + 1;
    end if;

    v_entity_key := 't' || left(md5(v_row.channel || v_row.source_id || p_run_id::text), 12);
    v_deadline := private.ai_ops_business_day_deadline(p_tenant_id, v_row.received_at, 1);

    v_payload := jsonb_build_object(
      'entityKey', v_entity_key,
      'channel', v_row.channel,
      'receivedAt', v_row.received_at,
      'ageHours', floor(extract(epoch from (p_cutoff_at - v_row.received_at)) / 3600)::int,
      'responseDeadlineAt', v_deadline,
      'deadlinePassed', v_deadline < p_cutoff_at,
      'responseEvidence', v_row.response_state,
      'hasLinkedClient', v_row.client_id is not null,
      'subject', left(coalesce(v_row.subject, ''), 300),
      'message', v_row.excerpt
    );

    insert into private.ai_ops_snapshots (
      tenant_id, entity_type, entity_id, snapshot_type, snapshot_hash, evaluation_hash,
      cutoff_at, payload, expires_at
    ) values (
      p_tenant_id, v_row.channel || '_message', v_row.source_id,
      'communications:' || p_run_id::text, v_entity_key,
      md5((v_payload - 'entityKey')::text), p_cutoff_at,
      v_payload || jsonb_build_object('clientId', v_row.client_id),
      now() + interval '14 days'
    );

    v_entities := v_entities || v_payload;
    v_queued_items := v_queued_items + 1;

    if jsonb_array_length(v_entities) >= v_batch_size then
      v_batch_index := v_batch_index + 1;
      perform public.ai_ops_enqueue_work(
        p_tenant_id, p_run_id, 'communications',
        'communications:' || p_run_id::text || ':' || v_batch_index::text,
        'communications_qa_review',
        jsonb_build_object('entities', v_entities),
        '1', '1', 80, 'gemini-2.5-pro', '{}'::uuid[]
      );
      v_batches := v_batches + 1;
      v_entities := '[]'::jsonb;
    end if;
  end loop;

  if jsonb_array_length(v_entities) > 0 then
    v_batch_index := v_batch_index + 1;
    perform public.ai_ops_enqueue_work(
      p_tenant_id, p_run_id, 'communications',
      'communications:' || p_run_id::text || ':' || v_batch_index::text,
      'communications_qa_review',
      jsonb_build_object('entities', v_entities),
      '1', '1', 80, 'gemini-2.5-pro', '{}'::uuid[]
    );
    v_batches := v_batches + 1;
  end if;

  return jsonb_build_object(
    'sourceItemsTotal', v_seen,
    'answered', v_answered,
    'responseStateUnknown', v_unknown,
    'itemsQueued', v_queued_items,
    'batchesQueued', v_batches,
    'sources', jsonb_build_object(
      'email', v_email,
      'portal', v_portal,
      'sms', v_sms,
      'ringcentralCalls', 'unavailable: no reliable client-linked call or voicemail records are persisted'
    ),
    'cutoffAt', p_cutoff_at
  );
end;
$function$;

revoke all on function public.ai_ops_build_communications_batches(uuid, uuid, timestamptz, integer, integer) from public, anon, authenticated;
grant execute on function public.ai_ops_build_communications_batches(uuid, uuid, timestamptz, integer, integer) to service_role;