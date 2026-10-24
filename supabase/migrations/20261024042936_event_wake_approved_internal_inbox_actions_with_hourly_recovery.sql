-- Fast path: wake the same tightly scoped service worker after an authorized CRM approval.
-- The hourly job remains the recovery path if this asynchronous HTTP enqueue fails.
CREATE OR REPLACE FUNCTION private.autonomous_inbox_wake_approved_action_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_token text;
BEGIN
 IF NEW.status<>'approved' OR OLD.status='approved'
 OR NEW.approved_by IS NULL OR NEW.approved_at IS NULL
 OR NEW.intent_type<>'internal_followup'
 OR NEW.proposal->>'operation'<>'verify_existing_crm_review_task'
 THEN RETURN NEW; END IF;
 BEGIN
  SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets
   WHERE name='cron_secret' LIMIT 1;
  IF coalesce(v_token,'')='' THEN
   RAISE WARNING 'Authorized inbox action wake is unconfigured; hourly fallback retained';
   RETURN NEW;
  END IF;
  PERFORM net.http_post(
   url:='https://ahqauomkgflopxgnlndd.supabase.co/functions/v1/autonomous-inbox-approved-action-worker',
   body:='{}'::jsonb,
   headers:=jsonb_build_object('Content-Type','application/json','X-Cron-Secret',v_token),
   timeout_milliseconds:=15000);
 EXCEPTION WHEN OTHERS THEN
  -- External wake failure must not undo a CRM operator's approval.
  RAISE WARNING 'Inbox approval wake deferred to hourly recovery (SQLSTATE=%)',SQLSTATE;
 END;
 RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION private.autonomous_inbox_wake_approved_action_v1()
 FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS autonomous_inbox_wake_approved_action
 ON private.autonomous_inbox_action_intents;
CREATE TRIGGER autonomous_inbox_wake_approved_action
 AFTER UPDATE OF status ON private.autonomous_inbox_action_intents
 FOR EACH ROW
 WHEN (NEW.status='approved' AND OLD.status IS DISTINCT FROM NEW.status)
 EXECUTE FUNCTION private.autonomous_inbox_wake_approved_action_v1();
