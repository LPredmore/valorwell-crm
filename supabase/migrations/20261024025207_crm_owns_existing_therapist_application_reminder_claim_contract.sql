-- Canonical CRM-owned definition, copied from production after verified no-op reapply.
CREATE OR REPLACE FUNCTION public.crm_claim_therapist_application_reminders(p_limit integer DEFAULT 10)
 RETURNS TABLE(id uuid, tenant_id uuid, invite_id uuid, step smallint, claim_token uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF NOT private.valorwell_is_service_role() THEN
   RAISE EXCEPTION 'ROLE_DENIED' USING errcode='42501';
 END IF;
 IF (clock_timestamp() AT TIME ZONE 'America/Chicago')::time < time '06:00'
    OR (clock_timestamp() AT TIME ZONE 'America/Chicago')::time >= time '18:00'
 THEN RETURN; END IF;
 RETURN QUERY WITH candidates AS (
   SELECT j.id FROM public.therapist_application_reminder_jobs j
   JOIN public.therapist_application_invites i ON i.id=j.invite_id AND i.tenant_id=j.tenant_id
   JOIN public.website_submissions s ON s.id=i.submission_id AND s.tenant_id=i.tenant_id
   JOIN public.provider_applicants a ON a.id=s.provider_applicant_id AND a.tenant_id=s.tenant_id
   JOIN public.therapist_application_followup_campaign_control c ON c.tenant_id=i.tenant_id
   WHERE c.enabled AND c.activated_at IS NOT NULL
     AND i.campaign_enrolled AND i.status='sent'
     AND i.created_at>=c.activated_at AND s.created_at>=c.activated_at
     AND s.consent IS TRUE AND s.source_system='website'
     AND s.submission_type='clinician_application'
     AND s.payload->>'source'='clinician_interest_form'
     AND lower(s.payload->>'email')=lower(i.email)
     AND a.status='contacted'::public.provider_applicant_status_enum
     AND a.source='website' AND a.source_record_key=s.id::text
     AND a.closed_at IS NULL AND a.converted_staff_id IS NULL
     AND NOT EXISTS(
       SELECT 1 FROM public.therapist_applications t
       WHERE t.tenant_id=i.tenant_id AND lower(t.email)=lower(i.email)
     )
     AND ((j.status IN ('scheduled','failed') AND j.scheduled_for<=clock_timestamp()
       AND j.attempt_count<j.max_attempts)
       OR (j.status='processing' AND j.claimed_at<clock_timestamp()-interval '15 minutes'
          AND j.attempt_count<j.max_attempts))
   ORDER BY j.scheduled_for,j.created_at FOR UPDATE OF j SKIP LOCKED
   LIMIT greatest(1,least(coalesce(p_limit,10),25))
 ),claimed AS (
   UPDATE public.therapist_application_reminder_jobs j
   SET status='processing',claim_token=gen_random_uuid(),claimed_at=clock_timestamp(),
       attempt_count=attempt_count+1,updated_at=clock_timestamp()
   FROM candidates WHERE j.id=candidates.id RETURNING j.*
 )
 SELECT claimed.id,claimed.tenant_id,claimed.invite_id,claimed.step,claimed.claim_token FROM claimed;
END; $function$;

