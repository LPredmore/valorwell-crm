-- Avoid shadowing the plan primary-key column with a local PL/pgSQL variable.
CREATE OR REPLACE FUNCTION public.crm_recruitment_stage_held_plan(p_tenant_id uuid, p_sequence_id uuid, p_prospect_id uuid, p_start_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor uuid:=(select auth.uid());gate jsonb;rec record;v_plan_id uuid;
DECLARE start_time timestamptz:=coalesce(p_start_at,now());due_time timestamptz;
DECLARE cnt integer:=0;
BEGIN
 IF actor IS NULL OR
 NOT coalesce(private.crm_has_relationship_permission(actor,p_tenant_id,'edit_relationships'),false)
 OR public.crm_staff_tenant_for_applicant_pipeline() IS DISTINCT FROM p_tenant_id
 THEN RAISE EXCEPTION 'Recruitment plan staging denied' USING ERRCODE='42501'; END IF;
 IF start_time<now()-interval '1 hour' OR start_time>now()+interval '365 days'
 THEN RAISE EXCEPTION 'Requested planning date out of range'; END IF;
 -- Lock source workflow and sequence against changes while evaluating the gate.
 PERFORM 1 FROM public.crm_therapist_prospect_workflow
 WHERE tenant_id=p_tenant_id AND prospect_id=p_prospect_id FOR UPDATE;
 PERFORM 1 FROM public.crm_recruitment_draft_sequences
 WHERE tenant_id=p_tenant_id AND crm_recruitment_draft_sequences.id=p_sequence_id FOR SHARE;
 gate:=public.crm_recruitment_delivery_gate(p_tenant_id,p_sequence_id,p_prospect_id);
 IF NOT (gate->>'canCreateHeldPlan')::boolean
 THEN RAISE EXCEPTION 'Plan not eligible: %',gate->'reasons'; END IF;
 IF (gate->>'sendingEnabled')::boolean OR (gate->>'canSend')::boolean
 THEN RAISE EXCEPTION 'Recruitment delivery safety gate unexpectedly enabled'; END IF;
 INSERT INTO public.crm_recruitment_delivery_plans(
  tenant_id,sequence_id,prospect_id,recipient_email,start_at,created_by)
 VALUES(p_tenant_id,p_sequence_id,p_prospect_id,gate->>'email',start_time,actor)
 RETURNING crm_recruitment_delivery_plans.id INTO v_plan_id;
 due_time:=start_time;
 FOR rec IN SELECT step_order,delay_days,subject,body_text
 FROM public.crm_recruitment_draft_steps
 WHERE tenant_id=p_tenant_id AND sequence_id=p_sequence_id ORDER BY step_order LOOP
  cnt:=cnt+1;
  due_time:=due_time+make_interval(days=>rec.delay_days);
  INSERT INTO public.crm_recruitment_delivery_steps
   (tenant_id,plan_id,step_order,scheduled_for,subject,body_text,state)
  VALUES(p_tenant_id,v_plan_id,rec.step_order,due_time,rec.subject,rec.body_text,'held');
 END LOOP;
 IF cnt=0 THEN RAISE EXCEPTION 'Cannot plan an empty sequence'; END IF;
 RETURN jsonb_build_object('planId',v_plan_id,'stepCount',cnt,
  'state','held','sendingEnabled',false,
  'message','Created immutable step snapshots on HOLD. No delivery/scheduling worker is active.');
END $function$
;
REVOKE ALL ON FUNCTION public.crm_recruitment_stage_held_plan(uuid,uuid,uuid,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_recruitment_stage_held_plan(uuid,uuid,uuid,timestamptz) TO authenticated;