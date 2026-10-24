CREATE OR REPLACE FUNCTION public.crm_autonomous_inbox_review_v1(p_case_id uuid, p_decision text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_case public.valorwell_hourly_comms_review_cases%rowtype;
 v_actor uuid; v_note text;
BEGIN
 v_actor:=(SELECT auth.uid());
 IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 IF p_decision NOT IN ('resolved','ignored') THEN
  RAISE EXCEPTION 'Invalid decision' USING ERRCODE='22023';
 END IF;
 IF length(coalesce(p_note,''))>1000 THEN
  RAISE EXCEPTION 'Review note exceeds 1000 characters' USING ERRCODE='22023';
 END IF;
 SELECT * INTO v_case
 FROM public.valorwell_hourly_comms_review_cases c
 WHERE c.id=p_case_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Case not found' USING ERRCODE='P0002'; END IF;
 IF NOT coalesce(private.crm_has_relationship_permission(v_actor,v_case.tenant_id,'edit_relationships'),false) THEN
  RAISE EXCEPTION 'Autonomous inbox review denied' USING ERRCODE='42501'; END IF;
 IF v_case.state<>'pending_review' THEN
  RETURN jsonb_build_object('id',v_case.id,'status',v_case.state,'idempotent',true);
 END IF;
 -- Cancel any unexecuted approval when a case is closed.
 UPDATE private.autonomous_inbox_action_intents
 SET status='cancelled',updated_at=clock_timestamp()
 WHERE tenant_id=v_case.tenant_id AND case_id=v_case.id
 AND status IN('proposed','awaiting_approval','approved');
 UPDATE public.valorwell_hourly_comms_review_cases
 SET state=p_decision,updated_at=clock_timestamp()
 WHERE id=v_case.id AND tenant_id=v_case.tenant_id;
 IF v_case.task_id IS NOT NULL THEN
  UPDATE public.crm_tasks t
  SET status=CASE WHEN p_decision='resolved' THEN 'completed'::public.crm_task_status_enum
                  ELSE 'canceled'::public.crm_task_status_enum END,
      completed_at=CASE WHEN p_decision='resolved' THEN clock_timestamp() ELSE NULL END,
      updated_at=clock_timestamp()
  WHERE t.id=v_case.task_id AND t.tenant_id=v_case.tenant_id
    AND t.tags @> ARRAY['hourly-inbox-assistant']::text[]
    AND t.relationship_contact_id IS NULL
    AND t.relationship_organization_id IS NULL
    AND t.relationship_opportunity_id IS NULL
    AND t.status NOT IN('completed','canceled');
 END IF;
 v_note:=nullif(btrim(coalesce(p_note,'')),'');
 INSERT INTO private.autonomous_inbox_case_events
 (tenant_id,case_id,event_key,event_kind,actor_profile_id,evidence)
 VALUES
 (v_case.tenant_id,v_case.id,'operator_review:'||gen_random_uuid()::text,
  'closed',v_actor,jsonb_build_object('decision',p_decision,'note',v_note));
 RETURN jsonb_build_object('id',v_case.id,'status',p_decision,'idempotent',false);
END;
$function$;

REVOKE ALL ON FUNCTION public.crm_autonomous_inbox_review_v1(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_autonomous_inbox_review_v1(uuid,text,text) TO authenticated;
