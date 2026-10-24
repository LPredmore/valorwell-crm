-- Production-mirrored operational health snapshot for the hourly assistant. No identifiers or PHI.
CREATE OR REPLACE FUNCTION public.valorwell_hourly_operations_health_v1()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT jsonb_build_object(
  'appointment_pending_over_10m',(SELECT count(*) FROM private.appointment_provisioning_jobs j WHERE j.status='pending' AND j.created_at<now()-interval '10 minutes'),
  'appointment_failed',(SELECT count(*) FROM private.appointment_provisioning_jobs j WHERE j.status='failed'),
  'appointment_failed_recent_24h',(SELECT count(*) FROM private.appointment_provisioning_jobs j WHERE j.status='failed' AND j.updated_at>now()-interval '24 hours'),
  'billing_outbox_stale_10m',(SELECT count(*) FROM public.integration_outbox o WHERE o.destination='billing' AND o.status='pending' AND o.created_at<now()-interval '10 minutes'),
  'therapist_match_outbox_overdue',(SELECT count(*) FROM public.integration_outbox o WHERE o.destination='therapist_match_worker' AND o.status IN('pending','failed') AND o.available_at<now()-interval '10 minutes'),
  'applicant_invites_overdue',(SELECT count(*) FROM public.therapist_application_invites i WHERE i.status IN('pending','failed') AND i.created_at<now()-interval '1 hour'),
  'open_comms_reviews',(SELECT count(*) FROM public.valorwell_hourly_comms_review_cases c WHERE c.state='pending_review')
 );
$function$

REVOKE ALL ON FUNCTION public.valorwell_hourly_operations_health_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.valorwell_hourly_operations_health_v1() TO service_role;
