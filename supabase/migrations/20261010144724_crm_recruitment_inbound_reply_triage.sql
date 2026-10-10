-- Inbound recruiter reply classification. Never queues/sends outbound.
CREATE TABLE public.crm_recruitment_inbound_triage (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 prospect_id uuid NOT NULL,
 email_message_id uuid NOT NULL,
 classification text NOT NULL CHECK(classification IN ('opt_out','possible_interest','possible_decline','needs_review')),
 review_status text NOT NULL DEFAULT 'pending' CHECK(review_status IN ('pending','resolved','opted_out')),
 decision text CHECK(decision IN ('interested','declined','ignore','opt_out')),
 reviewed_by uuid REFERENCES public.profiles(id),
 reviewed_at timestamptz,
 summary text NOT NULL,
 occurred_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (tenant_id,email_message_id),
 FOREIGN KEY (tenant_id,prospect_id) REFERENCES public.crm_therapist_prospect_workflow(tenant_id,prospect_id) ON DELETE CASCADE,
 FOREIGN KEY (tenant_id,email_message_id) REFERENCES public.crm_email_messages(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX crm_recruitment_inbound_triage_pending_idx
 ON public.crm_recruitment_inbound_triage(tenant_id,review_status,occurred_at DESC);
ALTER TABLE public.crm_recruitment_inbound_triage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_recruitment_inbound_triage FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.crm_recruitment_classify_inbound()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $trigger$
DECLARE candidate uuid;matches integer;state text:='needs_review';
DECLARE first_line text;message text;optout boolean:=false;
BEGIN
 IF NEW.direction<>'inbound' OR NEW.status<>'received' OR NEW.source<>'inbound_webhook'
   OR NEW.sender_email IS NULL THEN RETURN NEW; END IF;
 -- Only a unique source email address already *manually* verified by staff.
 -- Ignore all other messages rather than guessing a person by name/subject.
 SELECT count(*),min(p.id) INTO matches,candidate
 FROM public.therapist_outreach_prospects p
 WHERE p.tenant_id=NEW.tenant_id
 AND p.email ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
 AND lower(btrim(p.email))=lower(btrim(NEW.sender_email));
 IF matches<>1 OR candidate IS NULL THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.crm_therapist_prospect_workflow w
  WHERE w.tenant_id=NEW.tenant_id AND w.prospect_id=candidate
  AND w.email_review_status='verified') THEN RETURN NEW; END IF;
 message:=coalesce(nullif(NEW.body_text,''),regexp_replace(coalesce(NEW.body_html,''),'<[^>]*>',' ','g'),'');
 first_line:=lower(btrim(split_part(left(message,2000),E'\n',1)));
 optout:=first_line ~ '^(please )?(unsubscribe( me)?|stop emailing me|do not contact me|remove me from (your )?(email |mailing )?list)[.! ]*$';
 IF optout THEN state:='opt_out';
 ELSIF lower(left(message,350)) ~ '(interested|please send (me )?(details|information)|would like to learn more)'
 THEN state:='possible_interest';
 ELSIF lower(left(message,350)) ~ '(not interested|no thanks|no thank you)'
 THEN state:='possible_decline'; END IF;
 INSERT INTO public.crm_recruitment_inbound_triage
 (tenant_id,prospect_id,email_message_id,classification,review_status,summary,occurred_at)
 VALUES(NEW.tenant_id,candidate,NEW.id,state,
  CASE WHEN optout THEN 'opted_out' ELSE 'pending' END,
  left(coalesce(NEW.subject,'(No subject)'),220),
  NEW.occurred_at)
 ON CONFLICT(tenant_id,email_message_id) DO NOTHING;
 IF optout THEN
  INSERT INTO public.relationship_suppressions(tenant_id,scope,reason,email,source,source_record_key)
  SELECT NEW.tenant_id,'email','unsubscribe',lower(btrim(NEW.sender_email)),
   'crm_recruitment_inbound',NEW.id::text
  WHERE NOT EXISTS(SELECT 1 FROM public.relationship_suppressions s
   WHERE s.tenant_id=NEW.tenant_id AND s.scope='email'
    AND s.email=lower(btrim(NEW.sender_email)) AND s.revoked_at IS NULL
    AND (s.expires_at IS NULL OR s.expires_at>now()));
  UPDATE public.crm_therapist_prospect_workflow SET
   workflow_status='blocked',recruiting_stage='closed',
   next_action='Unsubscribe received: do not contact',next_action_due_at=NULL,
   version=version+1,updated_at=now()
  WHERE tenant_id=NEW.tenant_id AND prospect_id=candidate
    AND (workflow_status<>'blocked' OR recruiting_stage<>'closed');
 ELSE
  UPDATE public.crm_therapist_prospect_workflow SET
   recruiting_stage=CASE WHEN recruiting_stage IN ('not_contacted','contact_attempted') THEN 'replied' ELSE recruiting_stage END,
   next_action=CASE WHEN next_action IS NULL OR btrim(next_action)='' THEN 'Review incoming clinician reply' ELSE next_action END,
   next_action_due_at=CASE WHEN next_action_due_at IS NULL THEN now()+interval '1 day' ELSE next_action_due_at END,
   version=version+1,updated_at=now()
  WHERE tenant_id=NEW.tenant_id AND prospect_id=candidate
    AND recruiting_stage NOT IN ('closed','applicant_linked')
    AND workflow_status<>'blocked';
 END IF;
 RETURN NEW;
END $trigger$;
REVOKE ALL ON FUNCTION private.crm_recruitment_classify_inbound() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER crm_recruitment_inbound_message_triage
 AFTER INSERT ON public.crm_email_messages FOR EACH ROW
 EXECUTE FUNCTION private.crm_recruitment_classify_inbound();

CREATE FUNCTION public.crm_recruitment_reply_inbox(p_tenant_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE payload jsonb;
BEGIN
 IF (SELECT auth.uid()) IS NULL OR
 NOT coalesce(private.crm_has_relationship_permission(auth.uid(),p_tenant_id,'view_relationships'),false)
 OR public.crm_staff_tenant_for_applicant_pipeline() IS DISTINCT FROM p_tenant_id
 THEN RAISE EXCEPTION 'Recruitment reply inbox denied' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
 'id',r.id,'prospectId',r.prospect_id,'prospectName',concat_ws(' ',p.first_name,p.last_name),
 'subject',r.summary,'classification',r.classification,'reviewStatus',r.review_status,
 'decision',r.decision,'occurredAt',r.occurred_at)
 ORDER BY r.occurred_at DESC),'[]'::jsonb) INTO payload
 FROM (SELECT * FROM public.crm_recruitment_inbound_triage
 WHERE tenant_id=p_tenant_id ORDER BY occurred_at DESC LIMIT 100) r
 JOIN public.therapist_outreach_prospects p ON p.tenant_id=r.tenant_id AND p.id=r.prospect_id;
 RETURN payload;
END $fn$;
REVOKE ALL ON FUNCTION public.crm_recruitment_reply_inbox(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_recruitment_reply_inbox(uuid) TO authenticated;

CREATE FUNCTION public.crm_recruitment_review_reply(
 p_tenant_id uuid,p_reply_id uuid,p_decision text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE actor uuid:=(SELECT auth.uid()); rec public.crm_recruitment_inbound_triage%ROWTYPE;
DECLARE addr text;
BEGIN
 IF actor IS NULL OR
 NOT coalesce(private.crm_has_relationship_permission(actor,p_tenant_id,'edit_relationships'),false)
 OR public.crm_staff_tenant_for_applicant_pipeline() IS DISTINCT FROM p_tenant_id
 THEN RAISE EXCEPTION 'Recruitment reply review denied' USING ERRCODE='42501'; END IF;
 IF p_decision NOT IN ('interested','declined','ignore','opt_out')
 THEN RAISE EXCEPTION 'Invalid reply review decision'; END IF;
 SELECT * INTO rec FROM public.crm_recruitment_inbound_triage
 WHERE tenant_id=p_tenant_id AND id=p_reply_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Reply not found in tenant' USING ERRCODE='42501'; END IF;
 IF rec.review_status<>'pending' THEN RAISE EXCEPTION 'Reply already resolved'; END IF;
 SELECT lower(btrim(email)) INTO addr FROM public.therapist_outreach_prospects
 WHERE tenant_id=p_tenant_id AND id=rec.prospect_id;
 IF p_decision IN ('declined','opt_out') THEN
  UPDATE public.crm_therapist_prospect_workflow
  SET recruiting_stage='closed',workflow_status='blocked',
   next_action='Declined or opted out: do not contact',next_action_due_at=NULL,
   version=version+1,updated_at=now(),updated_by=actor
  WHERE tenant_id=p_tenant_id AND prospect_id=rec.prospect_id;
  IF addr ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN
   INSERT INTO public.relationship_suppressions(tenant_id,scope,reason,email,source,source_record_key)
   SELECT p_tenant_id,'email',
    CASE WHEN p_decision='opt_out' THEN 'unsubscribe' ELSE 'do_not_contact' END,
    addr,'crm_recruitment_review',rec.id::text
   WHERE NOT EXISTS(SELECT 1 FROM public.relationship_suppressions s
    WHERE s.tenant_id=p_tenant_id AND s.scope='email' AND lower(btrim(s.email))=addr
      AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at>now()));
  END IF;
 ELSIF p_decision='interested' THEN
  UPDATE public.crm_therapist_prospect_workflow SET
   recruiting_stage='interested',next_action='Follow up with interested clinician',
   next_action_due_at=coalesce(next_action_due_at,now()+interval '1 day'),
   version=version+1,updated_at=now(),updated_by=actor
  WHERE tenant_id=p_tenant_id AND prospect_id=rec.prospect_id
   AND workflow_status<>'blocked' AND recruiting_stage NOT IN ('closed','applicant_linked');
 END IF;
 UPDATE public.crm_recruitment_inbound_triage SET
  review_status='resolved',decision=p_decision,reviewed_by=actor,reviewed_at=now()
 WHERE id=rec.id;
 RETURN true;
END $fn$;
REVOKE ALL ON FUNCTION public.crm_recruitment_review_reply(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_recruitment_review_reply(uuid,uuid,text) TO authenticated;
NOTIFY pgrst,'reload schema';