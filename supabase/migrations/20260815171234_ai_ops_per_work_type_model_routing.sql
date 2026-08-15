create or replace function public.ai_ops_enqueue_work(
  p_tenant_id uuid,
  p_run_id uuid,
  p_module public.ai_ops_module_enum,
  p_work_key text,
  p_work_type text,
  p_input_payload jsonb,
  p_prompt_version text,
  p_schema_version text,
  p_priority integer default 100,
  p_model text default null,
  p_input_snapshot_ids uuid[] default '{}'::uuid[]
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_id uuid;
  v_inserted boolean := false;
  v_model text;
  v_default_model text;
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode = '42501';
  end if;

  select s.model into v_default_model
  from public.ai_operations_settings s
  where s.tenant_id = p_tenant_id;

  v_model := coalesce(
    nullif(p_model, ''),
    case
      when p_work_type in (
        'client_journey_review',
        'communications_qa_review',
        'executive_brief_synthesis',
        'staff_service_quality_review',
        'appointment_integrity_review',
        'billing_claims_review',
        'data_quality_review',
        'social_lead_review',
        'relationship_followup_review',
        'donor_opportunity_review',
        'content_opportunity_review',
        'content_performance_review',
        'bty_interview_prep',
        'bty_post_interview_review',
        'sop_compliance_review',
        'weekly_pattern_review'
      ) then 'gemini-2.5-pro'
      when p_work_type = 'youtube_comment_review' then 'gemini-2.5-flash'
      else null
    end,
    nullif(v_default_model, ''),
    'gemini-2.5-flash'
  );

  insert into private.ai_ops_work_items (
    tenant_id, run_id, module, work_key, work_type, priority,
    input_snapshot_ids, input_payload, requested_model, prompt_version, schema_version
  ) values (
    p_tenant_id, p_run_id, p_module, p_work_key, p_work_type, coalesce(p_priority, 100),
    coalesce(p_input_snapshot_ids, '{}'::uuid[]), p_input_payload, v_model,
    p_prompt_version, p_schema_version
  )
  on conflict (tenant_id, work_key) do nothing
  returning id into v_id;

  if v_id is not null then
    v_inserted := true;
  else
    select id into v_id
    from private.ai_ops_work_items
    where tenant_id = p_tenant_id and work_key = p_work_key;
  end if;

  return jsonb_build_object('workItemId', v_id, 'inserted', v_inserted, 'model', v_model);
end;
$function$;

update private.ai_ops_work_items
set requested_model = 'gemini-2.5-pro', updated_at = now()
where status in ('queued','retry_wait')
  and work_type in ('client_journey_review','communications_qa_review','executive_brief_synthesis');