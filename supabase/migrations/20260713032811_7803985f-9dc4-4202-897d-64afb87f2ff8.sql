
-- Enums
DO $$ BEGIN
  CREATE TYPE public.crm_task_status_enum AS ENUM
    ('not_started','in_progress','waiting','blocked','completed','canceled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.crm_task_priority_enum AS ENUM ('low','normal','high','urgent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.crm_task_type_enum AS ENUM
    ('client_follow_up','staff_follow_up','campaign_exception','eligibility_review',
     'match_review','documentation','risk_intervention','general');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.crm_exception_type_enum AS ENUM
    ('campaign_message_failed','campaign_step_overdue','client_reply_needs_review',
     'client_went_dark','client_became_at_risk','missed_appointment_follow_up',
     'eligibility_verification_failed','no_clinician_match_found','communication_suppressed',
     'assignment_missing','data_conflict','integration_failure','manual_review_required');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.crm_exception_severity_enum AS ENUM ('low','medium','high','critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.crm_exception_status_enum AS ENUM ('open','in_review','resolved','dismissed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- crm_tasks
CREATE TABLE IF NOT EXISTS public.crm_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  staff_id uuid,
  campaign_id uuid,
  exception_id uuid,
  type public.crm_task_type_enum NOT NULL DEFAULT 'general',
  priority public.crm_task_priority_enum NOT NULL DEFAULT 'normal',
  status public.crm_task_status_enum NOT NULL DEFAULT 'not_started',
  owner_id uuid,
  collaborator_ids uuid[] NOT NULL DEFAULT '{}',
  created_by_profile_id uuid NOT NULL,
  start_at timestamptz,
  due_at timestamptz,
  completed_at timestamptz,
  recurrence text,
  checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  tags text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_tasks_tenant_status ON public.crm_tasks(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_owner_due ON public.crm_tasks(owner_id, due_at);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_client ON public.crm_tasks(client_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_tasks TO authenticated;
GRANT ALL ON public.crm_tasks TO service_role;

ALTER TABLE public.crm_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crm_tasks read by tenant admin/staff" ON public.crm_tasks
  FOR SELECT TO authenticated USING (public.crm_has_role(auth.uid(), tenant_id));

CREATE POLICY "crm_tasks insert by tenant admin/staff" ON public.crm_tasks
  FOR INSERT TO authenticated WITH CHECK (public.crm_has_role(auth.uid(), tenant_id));

CREATE POLICY "crm_tasks update by tenant admin/staff" ON public.crm_tasks
  FOR UPDATE TO authenticated
  USING (public.crm_has_role(auth.uid(), tenant_id))
  WITH CHECK (public.crm_has_role(auth.uid(), tenant_id));

CREATE POLICY "crm_tasks delete by tenant admin/staff" ON public.crm_tasks
  FOR DELETE TO authenticated USING (public.crm_has_role(auth.uid(), tenant_id));

-- crm_exceptions
CREATE TABLE IF NOT EXISTS public.crm_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  type public.crm_exception_type_enum NOT NULL,
  severity public.crm_exception_severity_enum NOT NULL DEFAULT 'medium',
  status public.crm_exception_status_enum NOT NULL DEFAULT 'open',
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  campaign_id uuid,
  workflow text,
  owner_id uuid,
  due_at timestamptz,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  summary text NOT NULL,
  recommended_resolution text,
  resolution_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_exceptions_tenant_status ON public.crm_exceptions(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_crm_exceptions_client ON public.crm_exceptions(client_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_exceptions TO authenticated;
GRANT ALL ON public.crm_exceptions TO service_role;

ALTER TABLE public.crm_exceptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crm_exceptions read by tenant admin/staff" ON public.crm_exceptions
  FOR SELECT TO authenticated USING (public.crm_has_role(auth.uid(), tenant_id));

CREATE POLICY "crm_exceptions insert by tenant admin/staff" ON public.crm_exceptions
  FOR INSERT TO authenticated WITH CHECK (public.crm_has_role(auth.uid(), tenant_id));

CREATE POLICY "crm_exceptions update by tenant admin/staff" ON public.crm_exceptions
  FOR UPDATE TO authenticated
  USING (public.crm_has_role(auth.uid(), tenant_id))
  WITH CHECK (public.crm_has_role(auth.uid(), tenant_id));

CREATE POLICY "crm_exceptions delete by tenant admin/staff" ON public.crm_exceptions
  FOR DELETE TO authenticated USING (public.crm_has_role(auth.uid(), tenant_id));

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.crm_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_crm_tasks_updated ON public.crm_tasks;
CREATE TRIGGER trg_crm_tasks_updated BEFORE UPDATE ON public.crm_tasks
  FOR EACH ROW EXECUTE FUNCTION public.crm_touch_updated_at();

DROP TRIGGER IF EXISTS trg_crm_exceptions_updated ON public.crm_exceptions;
CREATE TRIGGER trg_crm_exceptions_updated BEFORE UPDATE ON public.crm_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.crm_touch_updated_at();
