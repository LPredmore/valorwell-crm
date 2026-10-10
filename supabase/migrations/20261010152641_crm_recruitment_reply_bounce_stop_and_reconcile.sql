-- Any reply, opt-out, bounce, loss of consent, or identity change stops HELD followups.
CREATE FUNCTION private.crm_recruitment_stop_held(
 p_tenant_id uuid,p_prospect_id uuid,p_reason text
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE affected integer;
BEGIN
 UPDATE public.crm_recruitment_delivery_steps d
 SET state='stopped',stopped_reason=left(p_reason,200),updated_at=now()
 FROM public.crm_recruitment_delivery_plans pl
 WHERE d.tenant_id=p_tenant_id AND pl.tenant_id=d.tenant_id AND pl.id=d.plan_id
  AND pl.prospect_id=p_prospect_id AND d.state='held';
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected>0 THEN
  UPDATE public.crm_recruitment_delivery_plans
  SET status='stopped',stopped_reason=left(p_reason,200),updated_at=now()
  WHERE tenant_id=p_tenant_id AND prospect_id=p_prospect_id AND status='held';
 END IF;
 RETURN affected;
END $fn$;
REVOKE ALL ON FUNCTION private.crm_recruitment_stop_held(uuid,uuid,text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.crm_recruitment_cancel_on_reply()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
BEGIN
 PERFORM private.crm_recruitment_stop_held(NEW.tenant_id,NEW.prospect_id,
  'Inbound clinician reply: '||NEW.classification);
 RETURN NEW;
END $fn$;
CREATE TRIGGER crm_recruitment_reply_stops_held
AFTER INSERT ON public.crm_recruitment_inbound_triage
FOR EACH ROW EXECUTE FUNCTION private.crm_recruitment_cancel_on_reply();

CREATE FUNCTION private.crm_recruitment_cancel_on_workflow()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
BEGIN
 IF NEW.workflow_status<>'ready' OR NEW.recruiting_stage<>'not_contacted'
 OR NEW.email_review_status<>'verified' THEN
  PERFORM private.crm_recruitment_stop_held(NEW.tenant_id,NEW.prospect_id,
   'Recruitment status or email review changed');
 END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER crm_recruitment_workflow_stops_held
AFTER UPDATE OF workflow_status,recruiting_stage,email_review_status
ON public.crm_therapist_prospect_workflow
FOR EACH ROW EXECUTE FUNCTION private.crm_recruitment_cancel_on_workflow();

CREATE FUNCTION private.crm_recruitment_cancel_on_source_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
BEGIN
 IF NEW.email IS DISTINCT FROM OLD.email OR
 NEW.outreach_contactable IS DISTINCT FROM OLD.outreach_contactable OR
 NEW.outreach_exclusion_reason IS DISTINCT FROM OLD.outreach_exclusion_reason THEN
  PERFORM private.crm_recruitment_stop_held(NEW.tenant_id,NEW.id,'Source email or exclusion changed');
 END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER crm_recruitment_source_stops_held
AFTER UPDATE OF email,outreach_contactable,outreach_exclusion_reason
ON public.therapist_outreach_prospects
FOR EACH ROW EXECUTE FUNCTION private.crm_recruitment_cancel_on_source_change();

CREATE FUNCTION private.crm_recruitment_cancel_on_consent_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
BEGIN
 IF NEW.email_permission<>'approved' THEN
  PERFORM private.crm_recruitment_stop_held(NEW.tenant_id,NEW.prospect_id,
   'Email contact permission revoked or unverified');
 END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER crm_recruitment_permission_stops_held
AFTER INSERT OR UPDATE OF email_permission ON public.crm_recruitment_contact_permissions
FOR EACH ROW EXECUTE FUNCTION private.crm_recruitment_cancel_on_consent_change();

CREATE FUNCTION private.crm_recruitment_cancel_on_suppression()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE pl record;
BEGIN
 IF NEW.revoked_at IS NOT NULL OR NEW.effective_at>now()
  OR (NEW.expires_at IS NOT NULL AND NEW.expires_at<=now()) THEN RETURN NEW; END IF;
 IF NEW.scope IN ('global','email') THEN
  FOR pl IN SELECT id,prospect_id FROM public.crm_recruitment_delivery_plans
   WHERE tenant_id=NEW.tenant_id AND status='held'
    AND (NEW.scope='global' OR lower(btrim(recipient_email))=lower(btrim(NEW.email))) LOOP
   PERFORM private.crm_recruitment_stop_held(NEW.tenant_id,pl.prospect_id,
    'Suppressed: '||NEW.reason);
  END LOOP;
 END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER crm_recruitment_suppression_stops_held
AFTER INSERT OR UPDATE OF revoked_at,effective_at ON public.relationship_suppressions
FOR EACH ROW EXECUTE FUNCTION private.crm_recruitment_cancel_on_suppression();

CREATE FUNCTION private.crm_recruitment_delivery_event_reconcile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE next_state text;pl record;recipient text;
BEGIN
 IF NEW.email_message_id IS NULL OR NEW.provider<>'resend' THEN RETURN NEW; END IF;
 next_state:=CASE NEW.event_type
  WHEN 'email.delivered' THEN 'delivered'
  WHEN 'email.bounced' THEN 'bounced'
  WHEN 'email.complained' THEN 'complained'
  WHEN 'email.failed' THEN 'failed'
  WHEN 'email.sent' THEN 'sent'
  ELSE NULL END;
 IF next_state IS NULL THEN RETURN NEW; END IF;
 -- Only records with an explicit recruitment ledger association are reconciled.
 UPDATE public.crm_recruitment_delivery_steps d
 SET state=CASE WHEN d.state IN ('bounced','complained') THEN d.state
    WHEN d.state='stopped' THEN 'stopped'
    WHEN d.state='held' THEN 'held'
    WHEN d.state='delivered' AND next_state='sent' THEN 'delivered'
    ELSE next_state END,
  last_error=CASE WHEN next_state IN ('failed','bounced','complained') THEN
   left(NEW.event_type,200) ELSE d.last_error END,
  updated_at=now()
 WHERE d.tenant_id=NEW.tenant_id AND d.email_message_id=NEW.email_message_id;
 IF next_state IN ('bounced','complained') THEN
  FOR pl IN SELECT pl.prospect_id,pl.recipient_email FROM public.crm_recruitment_delivery_plans pl
   JOIN public.crm_recruitment_delivery_steps d ON d.tenant_id=pl.tenant_id AND d.plan_id=pl.id
   WHERE d.tenant_id=NEW.tenant_id AND d.email_message_id=NEW.email_message_id LOOP
   PERFORM private.crm_recruitment_stop_held(NEW.tenant_id,pl.prospect_id,
    'Resend '||NEW.event_type);
   INSERT INTO public.relationship_suppressions(tenant_id,scope,reason,email,source,source_record_key)
    SELECT NEW.tenant_id,'email',CASE WHEN next_state='bounced' THEN 'bounce' ELSE 'complaint' END,
     pl.recipient_email,'crm_recruitment_delivery_event',NEW.id::text
    WHERE NOT EXISTS (SELECT 1 FROM public.relationship_suppressions s
     WHERE s.tenant_id=NEW.tenant_id AND s.scope='email'
      AND lower(btrim(s.email))=lower(btrim(pl.recipient_email))
      AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at>now()));
  END LOOP;
 END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER crm_recruitment_delivery_event_reconcile
AFTER INSERT ON public.crm_email_events
FOR EACH ROW EXECUTE FUNCTION private.crm_recruitment_delivery_event_reconcile();
REVOKE ALL ON FUNCTION private.crm_recruitment_cancel_on_reply() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.crm_recruitment_cancel_on_workflow() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.crm_recruitment_cancel_on_source_change() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.crm_recruitment_cancel_on_consent_change() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.crm_recruitment_cancel_on_suppression() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.crm_recruitment_delivery_event_reconcile() FROM PUBLIC,anon,authenticated;