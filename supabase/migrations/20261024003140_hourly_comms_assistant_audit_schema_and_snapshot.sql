-- Source-controlled mirror of verified Supabase production migration 20261024003140.
-- RLS denies direct user access; only service_role reads operational snapshots.
CREATE TABLE IF NOT EXISTS public.valorwell_hourly_comms_assistant_runs (
 run_hour timestamptz PRIMARY KEY,
 status text NOT NULL DEFAULT 'running' CHECK(status IN('running','ok','model_failed','snapshot_failed')),
 model text NOT NULL DEFAULT 'z-ai/glm-5.3-flash',
 metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
 findings jsonb NOT NULL DEFAULT '[]'::jsonb,
 error_code text,
 completed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.valorwell_hourly_comms_assistant_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.valorwell_hourly_comms_assistant_runs FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.valorwell_hourly_comms_assistant_runs TO service_role;
CREATE OR REPLACE FUNCTION public.valorwell_hourly_comms_snapshot_v1()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT jsonb_build_object(
  'observed_at',clock_timestamp(),
  'gmail',jsonb_build_object(
    'receipts_last_hour',(SELECT count(*) FROM private.relationship_gmail_source_receipts r WHERE r.retrieved_at > clock_timestamp()-interval '1 hour'),
    'receipts_unlinked_after_5_minutes',(SELECT count(*) FROM private.relationship_gmail_source_receipts r WHERE r.retrieved_at > clock_timestamp()-interval '24 hours' AND r.retrieved_at < clock_timestamp()-interval '5 minutes' AND NOT EXISTS(SELECT 1 FROM public.relationship_communications c WHERE c.tenant_id=r.tenant_id AND c.provider_message_id=r.provider_message_id)),
    'latest_receipt_at',(SELECT max(r.retrieved_at) FROM private.relationship_gmail_source_receipts r),
    'latest_any_google_sync_at',(SELECT max(s.last_successful_sync_at) FROM private.relationship_google_sync_state s JOIN private.relationship_google_connections c ON c.id=s.connection_id WHERE c.connection_type='gmail' AND c.status='active')
  ),
  'crm_email',jsonb_build_object(
    'inbound_last_hour',(SELECT count(*) FROM public.relationship_communications c WHERE c.channel='email' AND c.direction='inbound' AND c.created_at>clock_timestamp()-interval '1 hour'),
    'unlinked_inbound_last_24h',(SELECT count(*) FROM public.relationship_communications c WHERE c.channel='email' AND c.direction='inbound' AND c.created_at>clock_timestamp()-interval '24 hours' AND c.contact_id IS NULL AND c.organization_id IS NULL AND c.opportunity_id IS NULL)
  ),
  'ringcentral_crm',jsonb_build_object(
    'crm_inbound_sms_last_hour',(SELECT count(*) FROM public.crm_inbound_sms_logs s WHERE s.created_at>clock_timestamp()-interval '1 hour'),
    'crm_inbound_sms_last_24h',(SELECT count(*) FROM public.crm_inbound_sms_logs s WHERE s.created_at>clock_timestamp()-interval '24 hours'),
    'latest_crm_sms_at',(SELECT max(s.created_at) FROM public.crm_inbound_sms_logs s),
    'scope_note','This checks CRM webhook history only, not the connected personal RingCentral account or an authoritative provider pull'
  ),
  'database',jsonb_build_object(
    'failed_cron_last_hour',(SELECT count(*) FROM cron.job_run_details r WHERE r.status='failed' AND r.start_time>clock_timestamp()-interval '1 hour'),
    'active_minutely_jobs',(SELECT count(*) FROM cron.job j WHERE j.active AND j.schedule='* * * * *')
  )
 );
$function$

REVOKE ALL ON FUNCTION public.valorwell_hourly_comms_snapshot_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.valorwell_hourly_comms_snapshot_v1() TO service_role;
