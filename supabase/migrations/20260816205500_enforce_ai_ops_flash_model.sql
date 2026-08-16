-- Make Gemini 2.5 Flash the single authoritative model for all Gemini-backed
-- AI Operations work. Completed historical work keeps its recorded provenance.

update public.ai_operations_settings
set model = 'gemini-2.5-flash',
    updated_at = now()
where model is distinct from 'gemini-2.5-flash';

create or replace function public.ai_ops_enqueue_work(
  p_tenant_id uuid,
  p_run_id uuid,
  p_module ai_ops_module_enum,
  p_work_key text,
  p_work_type text,
  p_input_payload jsonb,
  p_prompt_version text,
  p_schema_version text,
  p_priority integer default 100,
  p_model text default null::text,
  p_input_snapshot_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_id uuid;
  v_inserted boolean := false;
  v_model text := 'gemini-2.5-flash';
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode = '42501';
  end if;

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

-- Normalize all non-completed work so retries and queued work cannot call Pro.
-- Completed rows are intentionally untouched to preserve historical model provenance.
update private.ai_ops_work_items
set requested_model = 'gemini-2.5-flash',
    updated_at = now()
where status::text in ('queued', 'processing', 'retry_wait', 'failed')
  and requested_model is distinct from 'gemini-2.5-flash';
