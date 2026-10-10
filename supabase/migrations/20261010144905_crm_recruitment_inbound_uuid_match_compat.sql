-- PostgreSQL does not provide min(uuid). Return the sole matched UUID by array aggregate.
CREATE OR REPLACE FUNCTION private.crm_recruitment_classify_inbound()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE candidate uuid;matches integer;state text:='needs_review';
DECLARE first_line text;message text;optout boolean:=false;
BEGIN
 IF NEW.direction<>'inbound' OR NEW.status<>'received' OR NEW.source<>'inbound_webhook'
   OR NEW.sender_email IS NULL THEN RETURN NEW; END IF;
 -- Only a unique source email address already *manually* verified by staff.
 -- Ignore all other messages rather than guessing a person by name/subject.
 SELECT count(*),(array_agg(p.id))[1] INTO matches,candidate
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
END $function$
;
REVOKE ALL ON FUNCTION private.crm_recruitment_classify_inbound() FROM PUBLIC,anon,authenticated;