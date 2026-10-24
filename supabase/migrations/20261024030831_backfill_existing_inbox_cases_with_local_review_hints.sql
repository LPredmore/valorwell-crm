-- Historical local case classification; no model call, no message content persisted.
WITH source_text AS (
 SELECT c.tenant_id,c.id case_id,
 lower(left(
   CASE WHEN c.source='gmail_crm'
     THEN coalesce(r.subject,'')||' '||coalesce(nullif(r.rendered_text,''),nullif(r.rendered_body,''),'')
     ELSE coalesce(s.message_body,'')
   END,4000)) body
 FROM public.valorwell_hourly_comms_review_cases c
 LEFT JOIN public.relationship_communications r
   ON c.source='gmail_crm' AND r.id=c.source_record_id AND r.tenant_id=c.tenant_id
 LEFT JOIN public.crm_inbound_sms_logs s
   ON c.source='ringcentral_crm' AND s.id=c.source_record_id AND s.tenant_id=c.tenant_id
),
classified AS (
 SELECT tenant_id,case_id,
 CASE
 WHEN body ~ '(^|[^[:alnum:]])(unsubscribe|remove me|do not contact|opt out)([^[:alnum:]]|$)' THEN 'opt_out_review'
 WHEN body ~ '(reschedul|appointment|interview time|availability|cancel.{0,25}(meeting|appointment|interview))' THEN 'scheduling_review'
 WHEN body ~ '(therapist.{0,25}application|clinician.{0,25}application|licens(e|ed|ure)|resume|résumé)' THEN 'applicant_review'
 WHEN body ~ '(donat(e|ion|ions)|sponsor(ship)?|partner(ship)?|collaborat)' THEN 'partnership_review'
 ELSE 'general_review' END category
 FROM source_text
),
added AS (
 INSERT INTO private.autonomous_inbox_case_triage_hints
  (tenant_id,case_id,ruleset_version,category)
 SELECT tenant_id,case_id,'local_rules_v1',category FROM classified
 ON CONFLICT(tenant_id,case_id,ruleset_version) DO NOTHING
 RETURNING tenant_id,case_id,category
)
INSERT INTO private.autonomous_inbox_case_events
(tenant_id,case_id,event_key,event_kind,evidence)
SELECT tenant_id,case_id,'classified:local_rules_v1','classified',
 jsonb_build_object('category',category,'rule','local_rules_v1','reviewRequired',true,'bodyStored',false)
FROM added ON CONFLICT(tenant_id,case_id,event_key) DO NOTHING;
