-- Production-verified: Service-only, bounded internal follow-up verification. No communication sends.
ALTER TABLE private.autonomous_inbox_action_intents
 ADD COLUMN IF NOT EXISTS execution_attempts integer NOT NULL DEFAULT 0
  CHECK(execution_attempts BETWEEN 0 AND 100),
 ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
 ADD COLUMN IF NOT EXISTS last_execution_error text
  CHECK(last_execution_error IS NULL OR last_execution_error IN
  ('missing_assigned_task','case_not_pending','approval_invalid','action_unsupported'));
ALTER TABLE private.autonomous_inbox_action_receipts
 ADD COLUMN IF NOT EXISTS execution_mode text NOT NULL DEFAULT 'crm_operator'
  CHECK(execution_mode IN('crm_operator','crm_service_worker'));
CREATE OR REPLACE FUNCTION public.autonomous_inbox_process_approved_v1(p_limit integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_action record;
 v_case public.valorwell_hourly_comms_review_cases%rowtype;
 v_task public.crm_tasks%rowtype;
 v_processed int:=0;
 v_verified int:=0;
 v_cancelled int:=0;
 v_deferred int:=0;
 v_terminal int:=0;
 v_new_attempts int;
 v_cap int:=least(greatest(coalesce(p_limit,25),1),25);
BEGIN
 IF NOT private.valorwell_is_service_role() THEN
  RAISE EXCEPTION 'Only the authorized inbox service may process actions' USING ERRCODE='42501';
 END IF;
 FOR v_action IN
  SELECT a.id,a.tenant_id,a.case_id,a.approved_by,a.approved_at,a.proposal,
         a.intent_type,a.execution_attempts
  FROM private.autonomous_inbox_action_intents a
  WHERE a.status='approved'
    AND (a.next_attempt_at IS NULL OR a.next_attempt_at<=clock_timestamp())
  ORDER BY a.approved_at ASC NULLS LAST,a.id ASC
  FOR UPDATE OF a SKIP LOCKED
  LIMIT v_cap
 LOOP
  v_processed:=v_processed+1;
  v_new_attempts:=v_action.execution_attempts+1;
  SELECT * INTO v_case FROM public.valorwell_hourly_comms_review_cases c
  WHERE c.id=v_action.case_id AND c.tenant_id=v_action.tenant_id;
  IF NOT FOUND OR v_case.state<>'pending_review' THEN
    UPDATE private.autonomous_inbox_action_intents
    SET status='cancelled',updated_at=clock_timestamp(),
        execution_attempts=v_new_attempts,last_execution_error='case_not_pending',
        next_attempt_at=NULL
    WHERE id=v_action.id;
    v_cancelled:=v_cancelled+1;
    CONTINUE;
  END IF;
  IF v_action.approved_by IS NULL OR v_action.approved_at IS NULL THEN
    UPDATE private.autonomous_inbox_action_intents
    SET status='failed',updated_at=clock_timestamp(),
        execution_attempts=v_new_attempts,last_execution_error='approval_invalid',
        next_attempt_at=NULL
    WHERE id=v_action.id;
    v_terminal:=v_terminal+1;
    CONTINUE;
  END IF;
  IF v_action.intent_type<>'internal_followup'
     OR v_action.proposal->>'operation'<>'verify_existing_crm_review_task' THEN
    UPDATE private.autonomous_inbox_action_intents
    SET status='failed',updated_at=clock_timestamp(),
        execution_attempts=v_new_attempts,last_execution_error='action_unsupported',
        next_attempt_at=NULL
    WHERE id=v_action.id;
    v_terminal:=v_terminal+1;
    CONTINUE;
  END IF;
  SELECT * INTO v_task FROM public.crm_tasks t
  WHERE t.id=v_case.task_id AND t.tenant_id=v_case.tenant_id
    AND t.owner_id IS NOT NULL
    AND t.tags @> ARRAY['hourly-inbox-assistant']::text[]
    AND t.relationship_contact_id IS NULL
    AND t.relationship_organization_id IS NULL
    AND t.relationship_opportunity_id IS NULL
    AND t.status NOT IN('canceled');
  IF NOT FOUND THEN
    IF v_new_attempts>=3 THEN
      UPDATE private.autonomous_inbox_action_intents
      SET status='failed',updated_at=clock_timestamp(),
          execution_attempts=v_new_attempts,last_execution_error='missing_assigned_task',
          next_attempt_at=NULL
      WHERE id=v_action.id;
      v_terminal:=v_terminal+1;
    ELSE
      UPDATE private.autonomous_inbox_action_intents
      SET execution_attempts=v_new_attempts,updated_at=clock_timestamp(),
          last_execution_error='missing_assigned_task',
          next_attempt_at=clock_timestamp()+make_interval(mins=>15*v_new_attempts)
      WHERE id=v_action.id;
      v_deferred:=v_deferred+1;
    END IF;
    CONTINUE;
  END IF;
  INSERT INTO private.autonomous_inbox_action_receipts
   (tenant_id,case_id,action_id,operation,outcome,source_task_id,performed_by,execution_mode)
  VALUES(v_action.tenant_id,v_action.case_id,v_action.id,
    'verified_existing_crm_review_task','verified',v_task.id,
    v_action.approved_by,'crm_service_worker')
  ON CONFLICT(action_id,operation) DO NOTHING;
  UPDATE private.autonomous_inbox_action_intents
  SET status='succeeded',updated_at=clock_timestamp(),
      execution_attempts=v_new_attempts,next_attempt_at=NULL,last_execution_error=NULL
  WHERE id=v_action.id;
  INSERT INTO private.autonomous_inbox_case_events
   (tenant_id,case_id,event_key,event_kind,actor_profile_id,evidence)
  VALUES(v_action.tenant_id,v_action.case_id,'followup_verified:'||v_action.id::text,
    'completed',v_action.approved_by,
    jsonb_build_object('actionId',v_action.id,'taskId',v_task.id,
    'result','verified_task_present','executionMode','crm_service_worker','outboundMessagesSent',0))
  ON CONFLICT(tenant_id,case_id,event_key) DO NOTHING;
  v_verified:=v_verified+1;
 END LOOP;
 RETURN jsonb_build_object(
  'processed',v_processed,'verified',v_verified,'cancelled',v_cancelled,
  'deferred',v_deferred,'failed_terminal',v_terminal,
  'outbound_messages_sent',0);
END;
$function$

REVOKE ALL ON FUNCTION public.autonomous_inbox_process_approved_v1(integer)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.autonomous_inbox_process_approved_v1(integer) TO service_role;
