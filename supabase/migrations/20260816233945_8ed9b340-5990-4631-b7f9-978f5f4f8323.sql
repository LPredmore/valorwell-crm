create or replace function public.command_center_findings(
  p_view text default 'active',
  p_category text default null,
  p_severity text default null,
  p_status text default null,
  p_module text default null,
  p_assigned_to uuid default null,
  p_since date default null,
  p_limit integer default 100,
  p_offset integer default 0
) returns jsonb
language plpgsql stable security definer set search_path to '' as $$
declare
  v_context jsonb := private.ai_ops_context(true);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
  v_actor uuid := (v_context->>'actor_id')::uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 300);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_view text := coalesce(nullif(btrim(p_view), ''), 'active');
  v_active text[] := array['open','reviewed','assigned','in_progress'];
  v_total integer;
begin
  select count(*)::int into v_total
  from public.ai_operations_findings f
  where f.tenant_id = v_tenant
    and (
      case v_view
        when 'active' then f.status::text = any(v_active)
        when 'mine' then f.status::text = any(v_active) and f.assigned_to_profile_id = v_actor
        when 'snoozed' then f.status::text = 'snoozed'
        when 'resolved' then f.status::text in ('resolved','dismissed')
        else true
      end
    )
    and (p_category is null or private.ai_ops_finding_category(f.module) = p_category)
    and (p_severity is null or f.severity::text = p_severity)
    and (p_status is null or f.status::text = p_status)
    and (p_module is null or f.module::text = p_module)
    and (p_assigned_to is null or f.assigned_to_profile_id = p_assigned_to)
    and (p_since is null or f.last_seen_at >= p_since::timestamptz);

  return jsonb_build_object(
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'items', coalesce((
      select jsonb_agg(row_to_json(x)::jsonb) from (
        select
          f.id,
          f.module::text as module,
          private.ai_ops_finding_category(f.module) as category,
          f.fingerprint,
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
          f.reviewed_at as "reviewedAt",
          f.assigned_at as "assignedAt",
          f.assigned_to_profile_id as "assignedToProfileId",
          pr.email as "assignedToEmail",
          f.occurrence_count as "occurrenceCount",
          f.last_occurrence_date as "lastOccurrenceDate",
          f.reopen_count as "reopenCount",
          f.related_existing_exception_id as "relatedExistingExceptionId",
          f.last_run_id as "lastRunId",
          r.business_date as "businessDate"
        from public.ai_operations_findings f
        left join public.ai_operations_runs r on r.id = f.last_run_id
        left join public.profiles pr on pr.id = f.assigned_to_profile_id
        where f.tenant_id = v_tenant
          and (
            case v_view
              when 'active' then f.status::text = any(v_active)
              when 'mine' then f.status::text = any(v_active) and f.assigned_to_profile_id = v_actor
              when 'snoozed' then f.status::text = 'snoozed'
              when 'resolved' then f.status::text in ('resolved','dismissed')
              else true
            end
          )
          and (p_category is null or private.ai_ops_finding_category(f.module) = p_category)
          and (p_severity is null or f.severity::text = p_severity)
          and (p_status is null or f.status::text = p_status)
          and (p_module is null or f.module::text = p_module)
          and (p_assigned_to is null or f.assigned_to_profile_id = p_assigned_to)
          and (p_since is null or f.last_seen_at >= p_since::timestamptz)
        order by
          case f.severity when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end,
          greatest(f.last_seen_at, f.updated_at) desc
        limit v_limit offset v_offset
      ) x
    ), '[]'::jsonb)
  );
end $$;

grant execute on function public.command_center_findings(text, text, text, text, text, uuid, date, integer, integer) to authenticated;