update public.ai_operations_smoke_checks
set assertion_sql = $$select count(*)::int as broken_count,
   (select count(*)::int from public.crm_tasks t2 where t2.tenant_id = $2 and t2.status in ('not_started','in_progress','waiting','blocked')) as source_count,
   coalesce(jsonb_agg(jsonb_build_object('taskId', t.id, 'ownerId', t.owner_id)) filter (where t.id is not null), '[]'::jsonb) as sample
   from public.crm_tasks t
   where t.tenant_id = $2 and t.status in ('not_started','in_progress','waiting','blocked')
     and t.owner_id is not null
     and not exists (select 1 from public.profiles p where p.id = t.owner_id)$$,
    updated_at = now()
where flow_key = 'tasks.open_task_owner_valid';