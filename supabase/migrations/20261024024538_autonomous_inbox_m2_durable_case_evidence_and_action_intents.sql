-- Source-control mirror of applied production migration 20261024024538.
-- Reuses canonical public.valorwell_hourly_comms_review_cases; no duplicate mailbox.
CREATE UNIQUE INDEX IF NOT EXISTS vw_hourly_cases_tenant_id_pair
 ON public.valorwell_hourly_comms_review_cases(tenant_id,id);
CREATE TABLE IF NOT EXISTS private.autonomous_inbox_case_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 case_id uuid NOT NULL,
 event_key text NOT NULL CHECK(length(event_key) BETWEEN 5 AND 200),
 event_kind text NOT NULL CHECK(event_kind IN ('observed','classified','proposed','reviewed','approved','rejected','completed','closed','followup_due','error')),
 actor_profile_id uuid,
 evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(evidence)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE (tenant_id,case_id,event_key),
 CONSTRAINT autonomous_case_event_parent_fk FOREIGN KEY(tenant_id,case_id)
 REFERENCES public.valorwell_hourly_comms_review_cases(tenant_id,id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS vw_autonomous_case_events_recent
 ON private.autonomous_inbox_case_events(tenant_id,case_id,created_at DESC);
ALTER TABLE private.autonomous_inbox_case_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.autonomous_inbox_case_events FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON private.autonomous_inbox_case_events TO service_role;
CREATE TABLE IF NOT EXISTS private.autonomous_inbox_action_intents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 case_id uuid NOT NULL,
 intent_key text NOT NULL CHECK(length(intent_key) BETWEEN 5 AND 180),
 intent_type text NOT NULL CHECK(intent_type IN ('draft_reply','review_contact_link','internal_followup','verify_external_status')),
 risk_tier text NOT NULL DEFAULT 'review' CHECK(risk_tier IN ('observe','review','restricted')),
 status text NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','awaiting_approval','approved','rejected','cancelled','succeeded','failed')),
 proposal jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(proposal)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 approved_by uuid,
 approved_at timestamptz,
 UNIQUE(tenant_id,case_id,intent_key),
 CONSTRAINT autonomous_action_parent_fk FOREIGN KEY(tenant_id,case_id)
 REFERENCES public.valorwell_hourly_comms_review_cases(tenant_id,id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS vw_autonomous_action_pending
 ON private.autonomous_inbox_action_intents(tenant_id,status,created_at DESC);
ALTER TABLE private.autonomous_inbox_action_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.autonomous_inbox_action_intents FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON private.autonomous_inbox_action_intents TO service_role;
CREATE OR REPLACE FUNCTION private.autonomous_inbox_case_observed_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 INSERT INTO private.autonomous_inbox_case_events
  (tenant_id,case_id,event_key,event_kind,evidence)
 VALUES
  (NEW.tenant_id,NEW.id,'observed:'||NEW.id::text,'observed',
   jsonb_build_object('source',NEW.source,'reason',NEW.reason,'source_record_id',NEW.source_record_id))
 ON CONFLICT (tenant_id,case_id,event_key) DO NOTHING;
 RETURN NEW;
END;
$function$

REVOKE ALL ON FUNCTION private.autonomous_inbox_case_observed_v1() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS vw_hourly_case_observed ON public.valorwell_hourly_comms_review_cases;
CREATE TRIGGER vw_hourly_case_observed AFTER INSERT ON public.valorwell_hourly_comms_review_cases
 FOR EACH ROW EXECUTE FUNCTION private.autonomous_inbox_case_observed_v1();
INSERT INTO private.autonomous_inbox_case_events
 (tenant_id,case_id,event_key,event_kind,evidence)
SELECT c.tenant_id,c.id,'observed:'||c.id::text,'observed',
 jsonb_build_object('source',c.source,'reason',c.reason,'source_record_id',c.source_record_id)
FROM public.valorwell_hourly_comms_review_cases c
ON CONFLICT(tenant_id,case_id,event_key) DO NOTHING;
