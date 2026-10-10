CREATE OR REPLACE FUNCTION private.crm_recruitment_delivery_event_reconcile()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE next_state text;matched_plan record;recipient text;
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
  FOR matched_plan IN SELECT src.prospect_id,src.recipient_email FROM public.crm_recruitment_delivery_plans src
   JOIN public.crm_recruitment_delivery_steps d ON d.tenant_id=src.tenant_id AND d.plan_id=src.id
   WHERE d.tenant_id=NEW.tenant_id AND d.email_message_id=NEW.email_message_id LOOP
   PERFORM private.crm_recruitment_stop_held(NEW.tenant_id,matched_plan.prospect_id,
    'Resend '||NEW.event_type);
   INSERT INTO public.relationship_suppressions(tenant_id,scope,reason,email,source,source_record_key)
    SELECT NEW.tenant_id,'email',CASE WHEN next_state='bounced' THEN 'bounce' ELSE 'complaint' END,
     matched_plan.recipient_email,'crm_recruitment_delivery_event',NEW.id::text
    WHERE NOT EXISTS (SELECT 1 FROM public.relationship_suppressions s
     WHERE s.tenant_id=NEW.tenant_id AND s.scope='email'
      AND lower(btrim(s.email))=lower(btrim(matched_plan.recipient_email))
      AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at>now()));
  END LOOP;
 END IF;
 RETURN NEW;
END $function$
;
REVOKE ALL ON FUNCTION private.crm_recruitment_delivery_event_reconcile() FROM PUBLIC,anon,authenticated;