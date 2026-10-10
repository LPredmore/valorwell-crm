-- Preview-safe delivery plan builder: creates only HELD ledger rows and snapshots.
CREATE FUNCTION public.crm_recruitment_stage_held_plan(
 p_tenant_id uuid,p_sequence_id uuid,p_prospect_id uuid,p_start_at timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE actor uuid:=(select auth.uid());gate jsonb;rec record;id uuid;
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
 WHERE tenant_id=p_tenant_id AND id=p_sequence_id FOR SHARE;
 gate:=public.crm_recruitment_delivery_gate(p_tenant_id,p_sequence_id,p_prospect_id);
 IF NOT (gate->>'canCreateHeldPlan')::boolean
 THEN RAISE EXCEPTION 'Plan not eligible: %',gate->'reasons'; END IF;
 IF (gate->>'sendingEnabled')::boolean OR (gate->>'canSend')::boolean
 THEN RAISE EXCEPTION 'Recruitment delivery safety gate unexpectedly enabled'; END IF;
 INSERT INTO public.crm_recruitment_delivery_plans(
  tenant_id,sequence_id,prospect_id,recipient_email,start_at,created_by)
 VALUES(p_tenant_id,p_sequence_id,p_prospect_id,gate->>'email',start_time,actor)
 RETURNING id INTO id;
 due_time:=start_time;
 FOR rec IN SELECT step_order,delay_days,subject,body_text
 FROM public.crm_recruitment_draft_steps
 WHERE tenant_id=p_tenant_id AND sequence_id=p_sequence_id ORDER BY step_order LOOP
  cnt:=cnt+1;
  due_time:=due_time+make_interval(days=>rec.delay_days);
  INSERT INTO public.crm_recruitment_delivery_steps
   (tenant_id,plan_id,step_order,scheduled_for,subject,body_text,state)
  VALUES(p_tenant_id,id,rec.step_order,due_time,rec.subject,rec.body_text,'held');
 END LOOP;
 IF cnt=0 THEN RAISE EXCEPTION 'Cannot plan an empty sequence'; END IF;
 RETURN jsonb_build_object('planId',id,'stepCount',cnt,
  'state','held','sendingEnabled',false,
  'message','Created immutable step snapshots on HOLD. No delivery/scheduling worker is active.');
END $fn$;
REVOKE ALL ON FUNCTION public.crm_recruitment_stage_held_plan(uuid,uuid,uuid,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_recruitment_stage_held_plan(uuid,uuid,uuid,timestamptz) TO authenticated;

CREATE FUNCTION public.crm_recruitment_delivery_ledger(
 p_tenant_id uuid,p_sequence_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE result jsonb;
BEGIN
 IF (SELECT auth.uid()) IS NULL OR
 NOT coalesce(private.crm_has_relationship_permission(auth.uid(),p_tenant_id,'view_relationships'),false)
 OR public.crm_staff_tenant_for_applicant_pipeline() IS DISTINCT FROM p_tenant_id
 THEN RAISE EXCEPTION 'Recruitment delivery ledger denied' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('sendingEnabled',false,
  'totalPlans',count(DISTINCT pl.id),
  'heldSteps',count(ds.id) FILTER (WHERE ds.state='held'),
  'stoppedSteps',count(ds.id) FILTER (WHERE ds.state='stopped'),
  'deliveredSteps',count(ds.id) FILTER (WHERE ds.state='delivered'),
  'bouncedSteps',count(ds.id) FILTER (WHERE ds.state='bounced'),
  'complainedSteps',count(ds.id) FILTER (WHERE ds.state='complained'),
  'items',coalesce(jsonb_agg(jsonb_build_object(
    'planId',pl.id,'prospectId',pl.prospect_id,'sequenceId',pl.sequence_id,
    'stepNumber',ds.step_order,'dueAt',ds.scheduled_for,'state',ds.state,
    'stoppedReason',ds.stopped_reason,'attemptCount',ds.attempt_count,
    'providerMessageId',ds.provider_message_id,'emailMessageId',ds.email_message_id,
    'lastError',ds.last_error
   ) ORDER BY ds.scheduled_for,ds.step_order)
   FILTER(WHERE ds.id IS NOT NULL),'[]'::jsonb))
 INTO result FROM public.crm_recruitment_delivery_plans pl
 LEFT JOIN public.crm_recruitment_delivery_steps ds
  ON ds.tenant_id=pl.tenant_id AND ds.plan_id=pl.id
 WHERE pl.tenant_id=p_tenant_id AND (p_sequence_id IS NULL OR pl.sequence_id=p_sequence_id);
 RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION public.crm_recruitment_delivery_ledger(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_recruitment_delivery_ledger(uuid,uuid) TO authenticated;

CREATE FUNCTION public.crm_recruitment_sequence_schedule_preview(
 p_tenant_id uuid,p_sequence_id uuid,p_start_at timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE seq public.crm_recruitment_draft_sequences%ROWTYPE;result jsonb;
BEGIN
 IF (SELECT auth.uid()) IS NULL OR
 NOT coalesce(private.crm_has_relationship_permission(auth.uid(),p_tenant_id,'view_relationships'),false)
 OR public.crm_staff_tenant_for_applicant_pipeline() IS DISTINCT FROM p_tenant_id
 THEN RAISE EXCEPTION 'Recruitment schedule preview denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO seq FROM public.crm_recruitment_draft_sequences
 WHERE tenant_id=p_tenant_id AND id=p_sequence_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Sequence unavailable in tenant' USING ERRCODE='42501'; END IF;
 WITH times AS (
 SELECT step_order,delay_days,subject,
  coalesce(p_start_at,now())+
   make_interval(days=>(sum(delay_days) OVER(ORDER BY step_order))::int) AS scheduled_for
 FROM public.crm_recruitment_draft_steps
 WHERE tenant_id=p_tenant_id AND sequence_id=p_sequence_id
 )
 SELECT jsonb_build_object('status','preview_only','sendingEnabled',false,
  'schedule',coalesce(jsonb_agg(jsonb_build_object(
   'stepNumber',step_order,'daysAfterPrevious',delay_days,
   'subject',subject,'plannedFor',scheduled_for) ORDER BY step_order),'[]'::jsonb))
 INTO result FROM times;
 RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION public.crm_recruitment_sequence_schedule_preview(uuid,uuid,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_recruitment_sequence_schedule_preview(uuid,uuid,timestamptz) TO authenticated;
NOTIFY pgrst,'reload schema';