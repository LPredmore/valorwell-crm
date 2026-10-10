-- Catch explicit stop requests and provider bounces even when prospect
-- identity was not manually verified. This only suppresses known source emails.
CREATE FUNCTION private.crm_recruitment_suppress_known_address(
 p_tenant_id uuid,p_email text,p_reason text,p_source text,p_source_id text
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE addr text:=lower(btrim(coalesce(p_email,'')));affected integer:=0;rec record;
BEGIN
 IF addr !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
 OR p_reason NOT IN ('unsubscribe','bounce','complaint') THEN RETURN 0; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.therapist_outreach_prospects p
 WHERE p.tenant_id=p_tenant_id AND lower(btrim(coalesce(p.email,'')))=addr) THEN RETURN 0; END IF;
 INSERT INTO public.relationship_suppressions(tenant_id,scope,reason,email,source,source_record_key)
 SELECT p_tenant_id,'email',p_reason,addr,left(p_source,120),left(p_source_id,200)
 WHERE NOT EXISTS(SELECT 1 FROM public.relationship_suppressions s
  WHERE s.tenant_id=p_tenant_id AND s.scope='email' AND lower(btrim(s.email))=addr
   AND s.revoked_at IS NULL AND s.effective_at<=now()
   AND (s.expires_at IS NULL OR s.expires_at>now()));
 FOR rec IN SELECT id FROM public.therapist_outreach_prospects
 WHERE tenant_id=p_tenant_id AND lower(btrim(coalesce(email,'')))=addr LOOP
  PERFORM private.crm_recruitment_stop_held(p_tenant_id,rec.id,
   'Known-address suppression: '||p_reason);
  UPDATE public.crm_therapist_prospect_workflow
  SET workflow_status='blocked',recruiting_stage='closed',
   next_action='Do not email — '||p_reason,next_action_due_at=NULL,
   version=version+1,updated_at=now()
  WHERE tenant_id=p_tenant_id AND prospect_id=rec.id
   AND (workflow_status<>'blocked' OR recruiting_stage<>'closed');
  affected:=affected+1;
 END LOOP;
 RETURN affected;
END $fn$;
REVOKE ALL ON FUNCTION private.crm_recruitment_suppress_known_address(uuid,text,text,text,text)
 FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.crm_recruitment_unverified_optout_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE raw_text text;first_line text;
BEGIN
 IF NEW.direction<>'inbound' OR NEW.status<>'received'
 OR NEW.source<>'inbound_webhook' OR NEW.sender_email IS NULL THEN RETURN NEW; END IF;
 raw_text:=coalesce(nullif(NEW.body_text,''),
  regexp_replace(coalesce(NEW.body_html,''),'<[^>]*>',' ','g'),'');
 first_line:=lower(btrim(split_part(left(raw_text,2000),E'\n',1)));
 IF first_line ~ '^(please )?(unsubscribe( me)?|stop emailing me|do not contact me|remove me from (your )?(email |mailing )?list)[.! ]*$'
 THEN PERFORM private.crm_recruitment_suppress_known_address(
  NEW.tenant_id,NEW.sender_email,'unsubscribe','crm_recruitment_unverified_optout',NEW.id::text);
 END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION private.crm_recruitment_unverified_optout_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER crm_recruitment_unverified_optout_guard
AFTER INSERT ON public.crm_email_messages FOR EACH ROW
EXECUTE FUNCTION private.crm_recruitment_unverified_optout_guard();

CREATE FUNCTION private.crm_recruitment_known_address_bounce_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE target_email text;
BEGIN
 IF NEW.provider<>'resend' OR NEW.event_type NOT IN('email.bounced','email.complained')
  OR NEW.email_message_id IS NULL THEN RETURN NEW; END IF;
 SELECT recipient_email INTO target_email FROM public.crm_email_messages
 WHERE tenant_id=NEW.tenant_id AND id=NEW.email_message_id AND direction='outbound';
 IF target_email IS NOT NULL THEN
  PERFORM private.crm_recruitment_suppress_known_address(NEW.tenant_id,target_email,
   CASE WHEN NEW.event_type='email.bounced' THEN 'bounce' ELSE 'complaint' END,
   'crm_recruitment_bounce_guard',NEW.id::text);
 END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION private.crm_recruitment_known_address_bounce_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER crm_recruitment_known_address_bounce_guard
AFTER INSERT ON public.crm_email_events FOR EACH ROW
EXECUTE FUNCTION private.crm_recruitment_known_address_bounce_guard();