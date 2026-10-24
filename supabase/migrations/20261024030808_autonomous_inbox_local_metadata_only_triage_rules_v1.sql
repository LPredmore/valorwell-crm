-- Review-only heuristic hints in the CRM's private DB. Never store email/SMS content or send it to an external model.
CREATE TABLE IF NOT EXISTS private.autonomous_inbox_case_triage_hints (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,
 ruleset_version text NOT NULL DEFAULT 'local_rules_v1',
 category text NOT NULL CHECK(category IN(
 'opt_out_review','scheduling_review','applicant_review','partnership_review','general_review')),
 assessment_kind text NOT NULL DEFAULT 'heuristic_review_only' CHECK(assessment_kind='heuristic_review_only'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,case_id,ruleset_version),
 FOREIGN KEY(tenant_id,case_id) REFERENCES public.valorwell_hourly_comms_review_cases(tenant_id,id)
);
ALTER TABLE private.autonomous_inbox_case_triage_hints ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.autonomous_inbox_case_triage_hints FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON private.autonomous_inbox_case_triage_hints TO service_role;
CREATE OR REPLACE FUNCTION private.autonomous_inbox_record_local_triage_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_source text;v_category text;
BEGIN
 IF NEW.source='gmail_crm' THEN
   SELECT left(coalesce(r.subject,'')||' '||
     coalesce(nullif(r.rendered_text,''),nullif(r.rendered_body,''),''),4000)
   INTO v_source
   FROM public.relationship_communications r
   WHERE r.id=NEW.source_record_id AND r.tenant_id=NEW.tenant_id
     AND r.channel='email' AND r.direction='inbound';
 ELSIF NEW.source='ringcentral_crm' THEN
   SELECT left(coalesce(s.message_body,''),4000) INTO v_source
   FROM public.crm_inbound_sms_logs s
   WHERE s.id=NEW.source_record_id AND s.tenant_id=NEW.tenant_id;
 ELSE RETURN NEW;
 END IF;
 -- Untrusted message content is used as a data-only, bounded regex input.
 -- Never execute instructions or forward it to an LLM from this database function.
 v_source:=lower(coalesce(v_source,''));
 v_category:=CASE
  WHEN v_source ~ '(^|[^[:alnum:]])(unsubscribe|remove me|do not contact|opt out)([^[:alnum:]]|$)'
    THEN 'opt_out_review'
  WHEN v_source ~ '(reschedul|appointment|interview time|availability|cancel.{0,25}(meeting|appointment|interview))'
    THEN 'scheduling_review'
  WHEN v_source ~ '(therapist.{0,25}application|clinician.{0,25}application|licens(e|ed|ure)|resume|résumé)'
    THEN 'applicant_review'
  WHEN v_source ~ '(donat(e|ion|ions)|sponsor(ship)?|partner(ship)?|collaborat)'
    THEN 'partnership_review'
  ELSE 'general_review'
 END;
 INSERT INTO private.autonomous_inbox_case_triage_hints
  (tenant_id,case_id,ruleset_version,category)
 VALUES(NEW.tenant_id,NEW.id,'local_rules_v1',v_category)
 ON CONFLICT(tenant_id,case_id,ruleset_version) DO NOTHING;
 INSERT INTO private.autonomous_inbox_case_events
  (tenant_id,case_id,event_key,event_kind,evidence)
 VALUES(NEW.tenant_id,NEW.id,'classified:local_rules_v1','classified',
   jsonb_build_object('category',v_category,'rule','local_rules_v1','reviewRequired',true,'bodyStored',false))
 ON CONFLICT(tenant_id,case_id,event_key) DO NOTHING;
 RETURN NEW;
EXCEPTION WHEN OTHERS THEN
 -- No email/message ingest should be blocked because triage hints cannot be computed.
 RAISE WARNING 'Local inbox triage failed with SQLSTATE %',SQLSTATE;
 RETURN NEW;
END;
$function$

REVOKE ALL ON FUNCTION private.autonomous_inbox_record_local_triage_v1() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS vw_hourly_case_local_triage ON public.valorwell_hourly_comms_review_cases;
CREATE TRIGGER vw_hourly_case_local_triage AFTER INSERT ON public.valorwell_hourly_comms_review_cases
 FOR EACH ROW EXECUTE FUNCTION private.autonomous_inbox_record_local_triage_v1();
