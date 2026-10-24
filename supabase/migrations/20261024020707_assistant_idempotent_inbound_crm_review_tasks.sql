-- Idempotent admin-only assistant cases and generated general CRM follow-up tasks.
-- Do not set relationship_contact_id/organization_id/opportunity_id in automated tasks;
-- the existing CRM permission trigger correctly requires an authorized user session.
CREATE TABLE IF NOT EXISTS public.valorwell_hourly_comms_review_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 source text NOT NULL CHECK(source IN ('gmail_crm','ringcentral_crm')),
 source_record_id uuid NOT NULL,
 state text NOT NULL DEFAULT 'pending_review' CHECK(state IN('pending_review','resolved','ignored')),
 reason text NOT NULL CHECK(reason IN('new_unanswered_inbound','missing_association','sms_unread')),
 task_id uuid REFERENCES public.crm_tasks(id) ON DELETE SET NULL,
 detected_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(source,source_record_id)
);
CREATE INDEX IF NOT EXISTS vw_hourly_comms_review_pending_idx
 ON public.valorwell_hourly_comms_review_cases(tenant_id,state,detected_at DESC) WHERE state='pending_review';
ALTER TABLE public.valorwell_hourly_comms_review_cases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.valorwell_hourly_comms_review_cases FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.valorwell_hourly_comms_review_cases TO service_role;
CREATE OR REPLACE FUNCTION public.valorwell_hourly_comms_triage_v1(p_lookback_hours integer DEFAULT 4)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_mail record;
 v_sms record;
 v_case uuid;
 v_task uuid;
 v_mail_added integer:=0;
 v_sms_added integer:=0;
 v_owner uuid:='d2dc0624-1e71-49d6-8b04-76cf1e822074'::uuid;
 v_limit int;
BEGIN
  -- Bound retries and prevent surprise historical task floods.
  v_limit:=least(greatest(coalesce(p_lookback_hours,4),1),48);
  FOR v_mail IN
    SELECT c.*
    FROM public.relationship_communications c
    WHERE c.channel='email'
      AND c.direction='inbound'
      AND c.created_at>=clock_timestamp()-make_interval(hours=>v_limit)
      AND c.occurred_at >= clock_timestamp()-interval '7 days'
      AND c.provider_message_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.relationship_communications o
        WHERE o.tenant_id=c.tenant_id
          AND o.channel='email' AND o.direction='outbound'
          AND o.provider_thread_id=c.provider_thread_id
          AND o.occurred_at>c.occurred_at
      )
    ORDER BY c.created_at ASC
    LIMIT 100
  LOOP
    INSERT INTO public.valorwell_hourly_comms_review_cases
      (tenant_id,source,source_record_id,reason)
    VALUES
      (v_mail.tenant_id,'gmail_crm',v_mail.id,
       CASE WHEN v_mail.contact_id IS NULL AND v_mail.organization_id IS NULL AND v_mail.opportunity_id IS NULL
         THEN 'missing_association' ELSE 'new_unanswered_inbound' END)
    ON CONFLICT(source,source_record_id) DO NOTHING
    RETURNING id INTO v_case;
    IF v_case IS NULL THEN CONTINUE; END IF;
    INSERT INTO public.crm_tasks
      (tenant_id,title,description,type,priority,status,owner_id,created_by_profile_id,due_at,
       relationship_contact_id,relationship_organization_id,relationship_opportunity_id,tags)
    VALUES
      (v_mail.tenant_id,'Review inbound CRM email',
       'Hourly inbox assistant: review the newly received email in the CRM, confirm its relationship and decide whether a reply or task is needed. No email was sent automatically. Assistant review case: '||v_case::text,
       'general','normal','not_started',v_owner,v_owner,clock_timestamp()+interval '1 day',
       NULL::uuid,NULL::uuid,NULL::uuid,
       ARRAY['hourly-inbox-assistant'])
    RETURNING id INTO v_task;
    UPDATE public.valorwell_hourly_comms_review_cases SET task_id=v_task WHERE id=v_case;
    v_mail_added:=v_mail_added+1;
    v_case:=NULL;
  END LOOP;
  FOR v_sms IN
    SELECT s.id,s.tenant_id
    FROM public.crm_inbound_sms_logs s
    WHERE s.created_at>=clock_timestamp()-make_interval(hours=>v_limit)
      AND s.is_read=false
      AND s.tenant_id IS NOT NULL
    ORDER BY s.created_at
    LIMIT 100
  LOOP
    INSERT INTO public.valorwell_hourly_comms_review_cases
      (tenant_id,source,source_record_id,reason)
    VALUES(v_sms.tenant_id,'ringcentral_crm',v_sms.id,'sms_unread')
    ON CONFLICT(source,source_record_id) DO NOTHING
    RETURNING id INTO v_case;
    IF v_case IS NULL THEN CONTINUE; END IF;
    INSERT INTO public.crm_tasks
      (tenant_id,title,description,type,priority,status,owner_id,created_by_profile_id,due_at,tags)
    VALUES(v_sms.tenant_id,'Review inbound CRM SMS',
      'Hourly inbox assistant: review this SMS in the CRM and determine whether follow-up is required. No SMS was sent automatically. Assistant review case: '||v_case::text,
      'general','normal','not_started',v_owner,v_owner,clock_timestamp()+interval '1 day',
      ARRAY['hourly-inbox-assistant'])
    RETURNING id INTO v_task;
    UPDATE public.valorwell_hourly_comms_review_cases SET task_id=v_task WHERE id=v_case;
    v_sms_added:=v_sms_added+1;
    v_case:=NULL;
  END LOOP;
  RETURN jsonb_build_object('new_email_review_tasks',v_mail_added,'new_sms_review_tasks',v_sms_added);
END;
$function$

REVOKE ALL ON FUNCTION public.valorwell_hourly_comms_triage_v1(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.valorwell_hourly_comms_triage_v1(integer) TO service_role;
