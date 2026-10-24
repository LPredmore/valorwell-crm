-- Existing-CRM-case action proposal and immutable verification receipt.
CREATE TABLE IF NOT EXISTS private.autonomous_inbox_action_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,action_id uuid NOT NULL,
 operation text NOT NULL CHECK(operation='verified_existing_crm_review_task'),
 outcome text NOT NULL CHECK(outcome='verified'),
 source_task_id uuid NOT NULL,performed_by uuid NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(action_id,operation),
 FOREIGN KEY(tenant_id,case_id) REFERENCES public.valorwell_hourly_comms_review_cases(tenant_id,id),
 FOREIGN KEY(action_id) REFERENCES private.autonomous_inbox_action_intents(id),
 FOREIGN KEY(source_task_id) REFERENCES public.crm_tasks(id)
);
ALTER TABLE private.autonomous_inbox_action_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.autonomous_inbox_action_receipts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON private.autonomous_inbox_action_receipts TO service_role;
CREATE OR REPLACE FUNCTION private.autonomous_inbox_seed_followup_intent_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_action uuid;
BEGIN
 IF NEW.state<>'pending_review' THEN RETURN NEW; END IF;
 INSERT INTO private.autonomous_inbox_action_intents
 (tenant_id,case_id,intent_key,intent_type,risk_tier,status,proposal)
 VALUES(NEW.tenant_id,NEW.id,'verify-followup:'||NEW.id::text,
  'internal_followup','review','awaiting_approval',
  jsonb_build_object('operation','verify_existing_crm_review_task',
    'summary','Confirm that a human-owned CRM review task exists for this message; do not send or modify any message.',
    'source',NEW.source,'review_reason',NEW.reason))
 ON CONFLICT(tenant_id,case_id,intent_key) DO NOTHING RETURNING id INTO v_action;
 IF v_action IS NOT NULL THEN
   INSERT INTO private.autonomous_inbox_case_events
     (tenant_id,case_id,event_key,event_kind,evidence)
   VALUES(NEW.tenant_id,NEW.id,'followup_proposed:'||v_action::text,
          'proposed',jsonb_build_object('actionId',v_action,'kind','verify_existing_crm_review_task'))
   ON CONFLICT(tenant_id,case_id,event_key) DO NOTHING;
 END IF;
 RETURN NEW;
END;
$function$

REVOKE ALL ON FUNCTION private.autonomous_inbox_seed_followup_intent_v1() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS vw_hourly_case_followup_proposal ON public.valorwell_hourly_comms_review_cases;
CREATE TRIGGER vw_hourly_case_followup_proposal AFTER INSERT ON public.valorwell_hourly_comms_review_cases
FOR EACH ROW EXECUTE FUNCTION private.autonomous_inbox_seed_followup_intent_v1();
WITH proposed AS (
 INSERT INTO private.autonomous_inbox_action_intents
 (tenant_id,case_id,intent_key,intent_type,risk_tier,status,proposal)
 SELECT c.tenant_id,c.id,'verify-followup:'||c.id::text,
 'internal_followup','review','awaiting_approval',
 jsonb_build_object('operation','verify_existing_crm_review_task',
 'summary','Confirm that a human-owned CRM review task exists for this message; do not send or modify any message.',
 'source',c.source,'review_reason',c.reason)
 FROM public.valorwell_hourly_comms_review_cases c WHERE c.state='pending_review'
 ON CONFLICT(tenant_id,case_id,intent_key) DO NOTHING
 RETURNING tenant_id,case_id,id
)
INSERT INTO private.autonomous_inbox_case_events(tenant_id,case_id,event_key,event_kind,evidence)
SELECT tenant_id,case_id,'followup_proposed:'||id::text,'proposed',
jsonb_build_object('actionId',id,'kind','verify_existing_crm_review_task')
FROM proposed ON CONFLICT(tenant_id,case_id,event_key) DO NOTHING;
