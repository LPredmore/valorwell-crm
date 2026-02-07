-- =============================================
-- CRM Campaign System Tables
-- =============================================

-- 1. crm_campaigns - Core campaign configuration
CREATE TABLE public.crm_campaigns (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  weekdays_only boolean NOT NULL DEFAULT false,
  send_window_start time NOT NULL DEFAULT '09:00:00',
  send_window_end time NOT NULL DEFAULT '17:00:00',
  default_timezone text NOT NULL DEFAULT 'America/Chicago',
  created_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. crm_campaign_steps - Individual messages in sequence
CREATE TABLE public.crm_campaign_steps (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES public.crm_campaigns(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  step_order integer NOT NULL DEFAULT 1,
  delay_days integer NOT NULL DEFAULT 0,
  delay_hours integer NOT NULL DEFAULT 0,
  channel text NOT NULL CHECK (channel IN ('email', 'sms')),
  email_subject text,
  email_body_html text,
  sms_body_text text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3. crm_campaign_enrollments - Links clients to campaigns
CREATE TABLE public.crm_campaign_enrollments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES public.crm_campaigns(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  current_step integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'cancelled', 'responded')),
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  enrolled_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  paused_at timestamptz,
  pause_reason text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Enforce one campaign per client per tenant
  CONSTRAINT crm_campaign_enrollments_unique_client UNIQUE (tenant_id, client_id)
);

-- 4. crm_campaign_step_logs - Audit trail of all sends
CREATE TABLE public.crm_campaign_step_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  enrollment_id uuid NOT NULL REFERENCES public.crm_campaign_enrollments(id) ON DELETE CASCADE,
  step_id uuid NOT NULL REFERENCES public.crm_campaign_steps(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  scheduled_for timestamptz NOT NULL,
  sent_at timestamptz,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'sent', 'failed', 'skipped')),
  skip_reason text,
  error_message text,
  channel text NOT NULL CHECK (channel IN ('email', 'sms')),
  helpscout_conversation_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- =============================================
-- Indexes for performance
-- =============================================

CREATE INDEX idx_crm_campaigns_tenant ON public.crm_campaigns(tenant_id);
CREATE INDEX idx_crm_campaigns_active ON public.crm_campaigns(tenant_id, is_active);

CREATE INDEX idx_crm_campaign_steps_campaign ON public.crm_campaign_steps(campaign_id);
CREATE INDEX idx_crm_campaign_steps_order ON public.crm_campaign_steps(campaign_id, step_order);

CREATE INDEX idx_crm_campaign_enrollments_campaign ON public.crm_campaign_enrollments(campaign_id);
CREATE INDEX idx_crm_campaign_enrollments_client ON public.crm_campaign_enrollments(client_id);
CREATE INDEX idx_crm_campaign_enrollments_status ON public.crm_campaign_enrollments(tenant_id, status);

CREATE INDEX idx_crm_campaign_step_logs_enrollment ON public.crm_campaign_step_logs(enrollment_id);
CREATE INDEX idx_crm_campaign_step_logs_scheduled ON public.crm_campaign_step_logs(status, scheduled_for) WHERE status = 'scheduled';
CREATE INDEX idx_crm_campaign_step_logs_client ON public.crm_campaign_step_logs(client_id);

-- =============================================
-- Updated_at triggers
-- =============================================

CREATE TRIGGER set_crm_campaigns_updated_at
  BEFORE UPDATE ON public.crm_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_crm_campaign_steps_updated_at
  BEFORE UPDATE ON public.crm_campaign_steps
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_crm_campaign_enrollments_updated_at
  BEFORE UPDATE ON public.crm_campaign_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================
-- Row Level Security
-- =============================================

ALTER TABLE public.crm_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_campaign_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_campaign_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_campaign_step_logs ENABLE ROW LEVEL SECURITY;

-- crm_campaigns policies
CREATE POLICY "Users can view campaigns in their tenant"
  ON public.crm_campaigns FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_memberships
      WHERE tenant_memberships.tenant_id = crm_campaigns.tenant_id
        AND tenant_memberships.profile_id = auth.uid()
    )
  );

CREATE POLICY "Users can create campaigns in their tenant"
  ON public.crm_campaigns FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tenant_memberships
      WHERE tenant_memberships.tenant_id = crm_campaigns.tenant_id
        AND tenant_memberships.profile_id = auth.uid()
    )
  );

CREATE POLICY "Users can update campaigns in their tenant"
  ON public.crm_campaigns FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_memberships
      WHERE tenant_memberships.tenant_id = crm_campaigns.tenant_id
        AND tenant_memberships.profile_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete campaigns in their tenant"
  ON public.crm_campaigns FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_memberships
      WHERE tenant_memberships.tenant_id = crm_campaigns.tenant_id
        AND tenant_memberships.profile_id = auth.uid()
    )
  );

-- crm_campaign_steps policies
CREATE POLICY "Users can view campaign steps in their tenant"
  ON public.crm_campaign_steps FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_memberships
      WHERE tenant_memberships.tenant_id = crm_campaign_steps.tenant_id
        AND tenant_memberships.profile_id = auth.uid()
    )
  );

CREATE POLICY "Users can create campaign steps in their tenant"
  ON public.crm_campaign_steps FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tenant_memberships
      WHERE tenant_memberships.tenant_id = crm_campaign_steps.tenant_id
        AND tenant_memberships.profile_id = auth.uid()
    )
  );

CREATE POLICY "Users can update campaign steps in their tenant"
  ON public.crm_campaign_steps FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_memberships
      WHERE tenant_memberships.tenant_id = crm_campaign_steps.tenant_id
        AND tenant_memberships.profile_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete campaign steps in their tenant"
  ON public.crm_campaign_steps FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_memberships
      WHERE tenant_memberships.tenant_id = crm_campaign_steps.tenant_id
        AND tenant_memberships.profile_id = auth.uid()
    )
  );

-- crm_campaign_enrollments policies
CREATE POLICY "Users can view enrollments in their tenant"
  ON public.crm_campaign_enrollments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_memberships
      WHERE tenant_memberships.tenant_id = crm_campaign_enrollments.tenant_id
        AND tenant_memberships.profile_id = auth.uid()
    )
  );

CREATE POLICY "Users can create enrollments in their tenant"
  ON public.crm_campaign_enrollments FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tenant_memberships
      WHERE tenant_memberships.tenant_id = crm_campaign_enrollments.tenant_id
        AND tenant_memberships.profile_id = auth.uid()
    )
  );

CREATE POLICY "Users can update enrollments in their tenant"
  ON public.crm_campaign_enrollments FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_memberships
      WHERE tenant_memberships.tenant_id = crm_campaign_enrollments.tenant_id
        AND tenant_memberships.profile_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete enrollments in their tenant"
  ON public.crm_campaign_enrollments FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_memberships
      WHERE tenant_memberships.tenant_id = crm_campaign_enrollments.tenant_id
        AND tenant_memberships.profile_id = auth.uid()
    )
  );

-- crm_campaign_step_logs policies
CREATE POLICY "Users can view step logs in their tenant"
  ON public.crm_campaign_step_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_memberships
      WHERE tenant_memberships.tenant_id = crm_campaign_step_logs.tenant_id
        AND tenant_memberships.profile_id = auth.uid()
    )
  );

CREATE POLICY "Users can create step logs in their tenant"
  ON public.crm_campaign_step_logs FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tenant_memberships
      WHERE tenant_memberships.tenant_id = crm_campaign_step_logs.tenant_id
        AND tenant_memberships.profile_id = auth.uid()
    )
  );

CREATE POLICY "Users can update step logs in their tenant"
  ON public.crm_campaign_step_logs FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_memberships
      WHERE tenant_memberships.tenant_id = crm_campaign_step_logs.tenant_id
        AND tenant_memberships.profile_id = auth.uid()
    )
  );

-- Service role policy for campaign-scheduler edge function
CREATE POLICY "Service role can manage step logs"
  ON public.crm_campaign_step_logs FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role can manage enrollments"
  ON public.crm_campaign_enrollments FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');