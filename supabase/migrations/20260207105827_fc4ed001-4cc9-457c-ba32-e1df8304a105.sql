-- Create crm_bulk_sms_logs table
CREATE TABLE public.crm_bulk_sms_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_by_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body_text text NOT NULL,
  recipient_count integer NOT NULL DEFAULT 0,
  sent_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  recipient_type text NOT NULL DEFAULT 'client',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

-- Create crm_bulk_sms_recipients table (for clients)
CREATE TABLE public.crm_bulk_sms_recipients (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  bulk_sms_id uuid NOT NULL REFERENCES public.crm_bulk_sms_logs(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create crm_bulk_sms_staff_recipients table (for staff)
CREATE TABLE public.crm_bulk_sms_staff_recipients (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  bulk_sms_id uuid NOT NULL REFERENCES public.crm_bulk_sms_logs(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX idx_crm_bulk_sms_logs_tenant_id ON public.crm_bulk_sms_logs(tenant_id);
CREATE INDEX idx_crm_bulk_sms_logs_status ON public.crm_bulk_sms_logs(status);
CREATE INDEX idx_crm_bulk_sms_recipients_bulk_sms_id ON public.crm_bulk_sms_recipients(bulk_sms_id);
CREATE INDEX idx_crm_bulk_sms_recipients_status ON public.crm_bulk_sms_recipients(status);
CREATE INDEX idx_crm_bulk_sms_staff_recipients_bulk_sms_id ON public.crm_bulk_sms_staff_recipients(bulk_sms_id);
CREATE INDEX idx_crm_bulk_sms_staff_recipients_status ON public.crm_bulk_sms_staff_recipients(status);

-- Enable RLS on all tables
ALTER TABLE public.crm_bulk_sms_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_bulk_sms_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_bulk_sms_staff_recipients ENABLE ROW LEVEL SECURITY;

-- RLS Policies for crm_bulk_sms_logs
CREATE POLICY "Tenant members can view SMS logs"
  ON public.crm_bulk_sms_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_memberships tm
      WHERE tm.tenant_id = crm_bulk_sms_logs.tenant_id
        AND tm.profile_id = auth.uid()
    )
  );

CREATE POLICY "Authenticated users can insert SMS logs for their tenant"
  ON public.crm_bulk_sms_logs
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tenant_memberships tm
      WHERE tm.tenant_id = crm_bulk_sms_logs.tenant_id
        AND tm.profile_id = auth.uid()
    )
  );

CREATE POLICY "Tenant members can update SMS logs"
  ON public.crm_bulk_sms_logs
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_memberships tm
      WHERE tm.tenant_id = crm_bulk_sms_logs.tenant_id
        AND tm.profile_id = auth.uid()
    )
  );

-- RLS Policies for crm_bulk_sms_recipients
CREATE POLICY "Tenant members can view SMS recipients"
  ON public.crm_bulk_sms_recipients
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_memberships tm
      WHERE tm.tenant_id = crm_bulk_sms_recipients.tenant_id
        AND tm.profile_id = auth.uid()
    )
  );

CREATE POLICY "Authenticated users can insert SMS recipients"
  ON public.crm_bulk_sms_recipients
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tenant_memberships tm
      WHERE tm.tenant_id = crm_bulk_sms_recipients.tenant_id
        AND tm.profile_id = auth.uid()
    )
  );

CREATE POLICY "Tenant members can update SMS recipients"
  ON public.crm_bulk_sms_recipients
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_memberships tm
      WHERE tm.tenant_id = crm_bulk_sms_recipients.tenant_id
        AND tm.profile_id = auth.uid()
    )
  );

-- RLS Policies for crm_bulk_sms_staff_recipients
CREATE POLICY "Tenant members can view SMS staff recipients"
  ON public.crm_bulk_sms_staff_recipients
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_memberships tm
      WHERE tm.tenant_id = crm_bulk_sms_staff_recipients.tenant_id
        AND tm.profile_id = auth.uid()
    )
  );

CREATE POLICY "Authenticated users can insert SMS staff recipients"
  ON public.crm_bulk_sms_staff_recipients
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tenant_memberships tm
      WHERE tm.tenant_id = crm_bulk_sms_staff_recipients.tenant_id
        AND tm.profile_id = auth.uid()
    )
  );

CREATE POLICY "Tenant members can update SMS staff recipients"
  ON public.crm_bulk_sms_staff_recipients
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_memberships tm
      WHERE tm.tenant_id = crm_bulk_sms_staff_recipients.tenant_id
        AND tm.profile_id = auth.uid()
    )
  );