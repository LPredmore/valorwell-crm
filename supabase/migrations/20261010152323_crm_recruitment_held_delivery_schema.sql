-- Phase 31: isolated, fail-closed recruitment delivery planning.
-- This schema has no dispatch/send entry point or active cron.
CREATE TABLE public.crm_recruitment_send_control(
 tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id),
 execution_enabled boolean NOT NULL DEFAULT false CHECK (execution_enabled=false),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.crm_recruitment_contact_permissions(
 tenant_id uuid NOT NULL,
 prospect_id uuid NOT NULL,
 email_permission text NOT NULL DEFAULT 'unknown' CHECK(email_permission IN ('unknown','approved','revoked')),
 evidence_source text,
 evidence_details text,
 reviewed_by uuid REFERENCES public.profiles(id),
 reviewed_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,prospect_id),
 FOREIGN KEY(tenant_id,prospect_id) REFERENCES public.crm_therapist_prospect_workflow(tenant_id,prospect_id) ON DELETE CASCADE,
 CHECK(email_permission<>'approved' OR
   (length(btrim(coalesce(evidence_source,''))) BETWEEN 5 AND 100
    AND length(btrim(coalesce(evidence_details,''))) BETWEEN 12 AND 1200
    AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE TABLE public.crm_recruitment_delivery_plans(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 sequence_id uuid NOT NULL,
 prospect_id uuid NOT NULL,
 recipient_email text NOT NULL,
 status text NOT NULL DEFAULT 'held' CHECK(status IN ('held','stopped')),
 stopped_reason text,
 start_at timestamptz NOT NULL,
 created_by uuid NOT NULL REFERENCES public.profiles(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),
 UNIQUE(tenant_id,sequence_id,prospect_id),
 FOREIGN KEY(tenant_id,sequence_id) REFERENCES public.crm_recruitment_draft_sequences(tenant_id,id),
 FOREIGN KEY(tenant_id,prospect_id) REFERENCES public.crm_therapist_prospect_workflow(tenant_id,prospect_id),
 CHECK(recipient_email ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')
);
CREATE TABLE public.crm_recruitment_delivery_steps(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 plan_id uuid NOT NULL,
 step_order integer NOT NULL CHECK(step_order BETWEEN 1 AND 6),
 scheduled_for timestamptz NOT NULL,
 subject text NOT NULL,
 body_text text NOT NULL,
 state text NOT NULL DEFAULT 'held'
 CHECK(state IN ('held','stopped','sent','delivered','bounced','complained','failed')),
 provider text,
 provider_message_id text,
 email_message_id uuid,
 stopped_reason text,
 attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0 AND attempt_count<=10),
 last_error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),
 UNIQUE(tenant_id,plan_id,step_order),
 FOREIGN KEY(tenant_id,plan_id) REFERENCES public.crm_recruitment_delivery_plans(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,email_message_id) REFERENCES public.crm_email_messages(tenant_id,id),
 CHECK (email_message_id IS NULL OR provider IS NOT NULL)
);
CREATE TABLE public.crm_recruitment_delivery_attempts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 delivery_step_id uuid NOT NULL,
 attempt_number integer NOT NULL CHECK(attempt_number BETWEEN 1 AND 10),
 idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 16 AND 200),
 result text NOT NULL CHECK(result IN ('blocked','retry','failed','accepted')),
 error_code text,
 provider_message_id text,
 attempted_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,delivery_step_id,attempt_number),
 UNIQUE(tenant_id,idempotency_key),
 FOREIGN KEY(tenant_id,delivery_step_id) REFERENCES public.crm_recruitment_delivery_steps(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX crm_recruitment_plan_prospect_idx
 ON public.crm_recruitment_delivery_plans(tenant_id,prospect_id,status);
CREATE INDEX crm_recruitment_delivery_steps_due_idx
 ON public.crm_recruitment_delivery_steps(tenant_id,state,scheduled_for);
CREATE INDEX crm_recruitment_delivery_steps_message_idx
 ON public.crm_recruitment_delivery_steps(tenant_id,email_message_id)
 WHERE email_message_id IS NOT NULL;

ALTER TABLE public.crm_recruitment_send_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_recruitment_contact_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_recruitment_delivery_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_recruitment_delivery_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_recruitment_delivery_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_recruitment_send_control,
 public.crm_recruitment_contact_permissions,public.crm_recruitment_delivery_plans,
 public.crm_recruitment_delivery_steps,public.crm_recruitment_delivery_attempts
 FROM PUBLIC,anon,authenticated;
INSERT INTO public.crm_recruitment_send_control(tenant_id)
 SELECT DISTINCT tenant_id FROM public.crm_therapist_prospect_workflow
 ON CONFLICT (tenant_id) DO NOTHING;