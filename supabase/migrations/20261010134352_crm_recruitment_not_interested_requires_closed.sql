-- A recorded not-interested outcome must not leave an initial-contact-eligible stage.
CREATE OR REPLACE FUNCTION public.crm_recruitment_log_contact(p_tenant_id uuid, p_prospect_id uuid, p_expected_version integer, p_channel text, p_direction text, p_outcome text, p_summary text, p_occurred_at timestamp with time zone, p_new_stage text, p_client_action_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_actor uuid:=(select auth.uid());
DECLARE v_old public.crm_therapist_prospect_workflow%ROWTYPE;
DECLARE v_event uuid;v_version integer;v_time timestamptz:=coalesce(p_occurred_at,now());
BEGIN
 IF v_actor IS NULL
  OR NOT coalesce(private.crm_has_relationship_permission(v_actor,p_tenant_id,'edit_relationships'),false)
  OR public.crm_staff_tenant_for_applicant_pipeline() IS DISTINCT FROM p_tenant_id
 THEN RAISE EXCEPTION 'Recruitment activity edit denied' USING ERRCODE='42501'; END IF;
 IF p_channel NOT IN ('email','sms','phone','linkedin','meeting','other','internal')
  OR p_direction NOT IN ('outbound','inbound','internal')
  OR p_outcome NOT IN ('attempted','responded','interested','not_interested','handoff','note')
  OR p_new_stage NOT IN ('not_contacted','contact_attempted','replied','interested','application_handoff','applicant_linked','closed')
  OR length(btrim(coalesce(p_summary,''))) NOT BETWEEN 3 AND 3000
  OR p_client_action_id IS NULL
  OR v_time>now()+interval '1 day'
 THEN RAISE EXCEPTION 'Invalid recruitment log fields'; END IF;
 SELECT * INTO v_old FROM public.crm_therapist_prospect_workflow
 WHERE tenant_id=p_tenant_id AND prospect_id=p_prospect_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Prospect workflow not found' USING ERRCODE='42501'; END IF;
 -- Idempotent retries cannot create extra events or move state a second time.
 SELECT id INTO v_event FROM public.crm_therapist_prospect_contact_events
 WHERE tenant_id=p_tenant_id AND client_action_id=p_client_action_id;
 IF v_event IS NOT NULL THEN
  RETURN jsonb_build_object('eventId',v_event,'version',v_old.version,'alreadyRecorded',true);
 END IF;
 IF v_old.version<>p_expected_version THEN RAISE EXCEPTION 'Prospect changed: reload before editing'; END IF;
 IF p_new_stage='applicant_linked' AND NOT EXISTS(
   SELECT 1 FROM public.crm_therapist_prospect_applicant_links
   WHERE tenant_id=p_tenant_id AND prospect_id=p_prospect_id
 ) THEN RAISE EXCEPTION 'Link an existing, verified applicant before choosing Applicant linked'; END IF;
 IF p_outcome='not_interested' AND p_new_stage<>'closed'
 THEN RAISE EXCEPTION 'Not interested outcomes must move the prospect to Closed'; END IF;
 IF p_new_stage='application_handoff' AND p_outcome<>'handoff'
 THEN RAISE EXCEPTION 'Application handoff requires a recorded handoff activity'; END IF;
 INSERT INTO public.crm_therapist_prospect_contact_events
 (tenant_id,prospect_id,actor_profile_id,channel,direction,outcome,summary,occurred_at,client_action_id)
 VALUES(p_tenant_id,p_prospect_id,v_actor,p_channel,p_direction,p_outcome,btrim(p_summary),v_time,p_client_action_id)
 RETURNING id INTO v_event;
 UPDATE public.crm_therapist_prospect_workflow
 SET recruiting_stage=p_new_stage,version=version+1,updated_at=now(),updated_by=v_actor
 WHERE tenant_id=p_tenant_id AND prospect_id=p_prospect_id RETURNING version INTO v_version;
 INSERT INTO public.crm_therapist_prospect_events
 (tenant_id,prospect_id,actor_profile_id,old_status,new_status,old_owner_profile_id,new_owner_profile_id,reason)
 VALUES(p_tenant_id,p_prospect_id,v_actor,v_old.workflow_status,v_old.workflow_status,
 v_old.owner_profile_id,v_old.owner_profile_id,
 'Recruitment activity ('||p_channel||' / '||p_outcome||', '||v_old.recruiting_stage||' → '||p_new_stage||'): '||left(btrim(p_summary),350));
 RETURN jsonb_build_object('eventId',v_event,'version',v_version,'alreadyRecorded',false);
END $function$
;
REVOKE ALL ON FUNCTION public.crm_recruitment_log_contact(uuid,uuid,integer,text,text,text,text,timestamptz,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_recruitment_log_contact(uuid,uuid,integer,text,text,text,text,timestamptz,text,uuid) TO authenticated;