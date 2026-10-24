CREATE OR REPLACE FUNCTION public.crm_autonomous_inbox_queue_v1(p_tenant_id uuid, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_data jsonb;v_count integer;
BEGIN
 IF (SELECT auth.uid()) IS NULL
   OR NOT coalesce(private.crm_has_relationship_permission((SELECT auth.uid()),p_tenant_id,'view_relationships'),false)
 THEN RAISE EXCEPTION 'Autonomous inbox access denied' USING ERRCODE='42501'; END IF;
 v_count:=least(greatest(coalesce(p_limit,50),1),100);
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',a.id,
   'source',a.source,
   'sourceRecordId',a.source_record_id,
   'reason',a.reason,
   'state',a.state,
   'detectedAt',a.detected_at,
   'taskId',a.task_id,
   'taskStatus',t.status::text,
   'triageHint',(SELECT h.category FROM private.autonomous_inbox_case_triage_hints h WHERE h.tenant_id=a.tenant_id AND h.case_id=a.id ORDER BY h.created_at DESC LIMIT 1),
   'triageMethod','local_rules_review_only',
   'observedEvents',(
     SELECT count(*) FROM private.autonomous_inbox_case_events e
     WHERE e.tenant_id=a.tenant_id AND e.case_id=a.id
   ),
   'proposedActions',(
     SELECT count(*) FROM private.autonomous_inbox_action_intents i
     WHERE i.tenant_id=a.tenant_id AND i.case_id=a.id
       AND i.status IN('proposed','awaiting_approval')
   )
 ) ORDER BY a.detected_at DESC),'[]'::jsonb)
 INTO v_data
 FROM (
  SELECT * FROM public.valorwell_hourly_comms_review_cases
  WHERE tenant_id=p_tenant_id ORDER BY detected_at DESC LIMIT v_count
 ) a
 LEFT JOIN public.crm_tasks t ON t.id=a.task_id AND t.tenant_id=a.tenant_id;
 RETURN jsonb_build_object('cases',v_data,
  'openCount',(SELECT count(*) FROM public.valorwell_hourly_comms_review_cases
   WHERE tenant_id=p_tenant_id AND state='pending_review'));
END;
$function$

REVOKE ALL ON FUNCTION public.crm_autonomous_inbox_queue_v1(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_autonomous_inbox_queue_v1(uuid,integer) TO authenticated;
