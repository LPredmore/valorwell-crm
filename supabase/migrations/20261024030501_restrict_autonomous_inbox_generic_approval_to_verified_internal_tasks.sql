CREATE OR REPLACE FUNCTION public.crm_autonomous_inbox_decide_action_v1(p_action_id uuid, p_decision text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_action private.autonomous_inbox_action_intents%rowtype;
 v_case public.valorwell_hourly_comms_review_cases%rowtype;
 v_actor uuid;v_target text;
BEGIN
 v_actor:=(SELECT auth.uid());
 IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 IF p_decision NOT IN ('approve','reject') THEN RAISE EXCEPTION 'Invalid decision' USING ERRCODE='22023'; END IF;
 IF length(coalesce(p_note,''))>500 THEN RAISE EXCEPTION 'Review note too long' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_action FROM private.autonomous_inbox_action_intents WHERE id=p_action_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unknown action' USING ERRCODE='P0002'; END IF;
 IF NOT coalesce(private.crm_has_relationship_permission(v_actor,v_action.tenant_id,'edit_relationships'),false)
 THEN RAISE EXCEPTION 'CRM action approval denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_case FROM public.valorwell_hourly_comms_review_cases
 WHERE id=v_action.case_id AND tenant_id=v_action.tenant_id FOR SHARE;
 IF NOT FOUND OR v_case.state<>'pending_review' THEN RAISE EXCEPTION 'Case no longer reviewable' USING ERRCODE='23514'; END IF;
 -- This version approves ONLY verification of an already-created internal CRM task.
 -- Any future external communication, financial or clinical action needs its own authorization path.
 IF v_action.intent_type<>'internal_followup'
   OR v_action.proposal->>'operation'<>'verify_existing_crm_review_task'
 THEN RAISE EXCEPTION 'This action type is not authorized for approval' USING ERRCODE='42501'; END IF;
 v_target:=CASE WHEN p_decision='approve' THEN 'approved' ELSE 'rejected' END;
 IF v_action.status=v_target THEN
  RETURN jsonb_build_object('id',v_action.id,'status',v_target,'idempotent',true,'messageSent',false);
 END IF;
 IF v_action.status NOT IN ('proposed','awaiting_approval')
 THEN RAISE EXCEPTION 'Action cannot be decided in its current state' USING ERRCODE='23514'; END IF;
 UPDATE private.autonomous_inbox_action_intents
 SET status=v_target,approved_by=CASE WHEN v_target='approved' THEN v_actor ELSE NULL END,
     approved_at=CASE WHEN v_target='approved' THEN clock_timestamp() ELSE NULL END,
     updated_at=clock_timestamp()
 WHERE id=v_action.id;
 INSERT INTO private.autonomous_inbox_case_events
  (tenant_id,case_id,event_key,event_kind,actor_profile_id,evidence)
 VALUES(v_action.tenant_id,v_action.case_id,'action_decision:'||gen_random_uuid()::text,
 CASE WHEN v_target='approved' THEN 'approved' ELSE 'rejected' END,v_actor,
 jsonb_build_object('actionId',v_action.id,'decision',v_target,'note',nullif(btrim(coalesce(p_note,'')),'')));
 RETURN jsonb_build_object('id',v_action.id,'status',v_target,'idempotent',false,'messageSent',false);
END;
$function$;

REVOKE ALL ON FUNCTION public.crm_autonomous_inbox_decide_action_v1(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_autonomous_inbox_decide_action_v1(uuid,text,text) TO authenticated;
