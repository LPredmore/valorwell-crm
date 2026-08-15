-- Data-modifying CTEs must be top level: assign into a variable instead of nesting in an expression.
create or replace function public.ai_ops_claim_work_items(p_limit integer default 4)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 4), 1), 20);
  v_result jsonb;
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode = '42501';
  end if;

  with claimed as (
    update private.ai_ops_work_items w
       set status = 'processing',
           attempt_count = w.attempt_count + 1,
           claimed_at = now(),
           updated_at = now()
     where w.id in (
       select id from private.ai_ops_work_items
        where status in ('queued','retry_wait')
          and next_attempt_at <= now()
        order by priority asc, next_attempt_at asc
        limit v_limit
        for update skip locked
     )
    returning w.*
  )
  select jsonb_agg(jsonb_build_object(
    'id', c.id,
    'tenantId', c.tenant_id,
    'runId', c.run_id,
    'module', c.module,
    'workKey', c.work_key,
    'workType', c.work_type,
    'inputPayload', c.input_payload,
    'requestedModel', c.requested_model,
    'promptVersion', c.prompt_version,
    'schemaVersion', c.schema_version,
    'attemptCount', c.attempt_count
  ) order by c.priority, c.created_at)
  into v_result
  from claimed c;

  return coalesce(v_result, '[]'::jsonb);
end;
$function$;

revoke all on function public.ai_ops_claim_work_items(integer) from public, anon, authenticated;
grant execute on function public.ai_ops_claim_work_items(integer) to service_role;