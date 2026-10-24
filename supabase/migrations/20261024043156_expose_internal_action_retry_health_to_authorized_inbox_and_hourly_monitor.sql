CREATE OR REPLACE FUNCTION public.crm_autonomous_inbox_actions_v1(p_case_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_case public.valorwell_hourly_comms_review_cases%rowtype;v_payload jsonb;
BEGIN
 IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_case FROM public.valorwell_hourly_comms_review_cases WHERE id=p_case_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unknown case' USING ERRCODE='P0002'; END IF;
 IF NOT coalesce(private.crm_has_relationship_permission((SELECT auth.uid()),v_case.tenant_id,'view_relationships'),false)
 THEN RAISE EXCEPTION 'CRM inbox action access denied' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
 'id',a.id,'type',a.intent_type,'riskTier',a.risk_tier,'status',a.status,
 'summary',a.proposal->>'summary','createdAt',a.created_at,
 'approvedAt',a.approved_at,
 'executionAttempts',a.execution_attempts,'nextAttemptAt',a.next_attempt_at,
 'lastErrorCode',a.last_execution_error,
 'verifiedReceipt',(SELECT jsonb_build_object('recordedAt',r.recorded_at,'outcome',r.outcome,'sourceTaskId',r.source_task_id)
 FROM private.autonomous_inbox_action_receipts r WHERE r.action_id=a.id LIMIT 1)
 ) ORDER BY a.created_at),'[]'::jsonb) INTO v_payload
 FROM private.autonomous_inbox_action_intents a
 WHERE a.tenant_id=v_case.tenant_id AND a.case_id=v_case.id;
 RETURN v_payload;
END;
$function$;
CREATE OR REPLACE FUNCTION public.valorwell_hourly_operations_health_v1()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT jsonb_build_object(
  'appointment_pending_over_10m',(SELECT count(*) FROM private.appointment_provisioning_jobs j WHERE j.status='pending' AND j.created_at<now()-interval '10 minutes'),
  'appointment_failed',(SELECT count(*) FROM private.appointment_provisioning_jobs j WHERE j.status='failed'),
  'appointment_failed_recent_24h',(SELECT count(*) FROM private.appointment_provisioning_jobs j WHERE j.status='failed' AND j.updated_at>now()-interval '24 hours'),
  'billing_outbox_stale_10m',(SELECT count(*) FROM public.integration_outbox o WHERE o.destination='billing' AND o.status='pending' AND o.created_at<now()-interval '10 minutes'),
  'therapist_match_outbox_overdue',(SELECT count(*) FROM public.integration_outbox o WHERE o.destination='therapist_match_worker' AND o.status IN('pending','failed') AND o.available_at<now()-interval '10 minutes'),
  'applicant_invites_overdue',(SELECT count(*) FROM public.therapist_application_invites i WHERE i.status IN('pending','failed') AND i.created_at<now()-interval '1 hour'),
  'open_comms_reviews',(SELECT count(*) FROM public.valorwell_hourly_comms_review_cases c WHERE c.state='pending_review'),
  'autonomous_inbox_waiting_approval',(SELECT count(*) FROM private.autonomous_inbox_action_intents a WHERE a.status='awaiting_approval'),
  'autonomous_inbox_approved_due',(SELECT count(*) FROM private.autonomous_inbox_action_intents a WHERE a.status='approved' AND (a.next_attempt_at IS NULL OR a.next_attempt_at<=now())),
  'autonomous_inbox_failed_actions',(SELECT count(*) FROM private.autonomous_inbox_action_intents a WHERE a.status='failed')
 );
$function$;
REVOKE ALL ON FUNCTION public.crm_autonomous_inbox_actions_v1(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_autonomous_inbox_actions_v1(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.valorwell_hourly_operations_health_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.valorwell_hourly_operations_health_v1() TO service_role;
