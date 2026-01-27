-- =============================================
-- ValorWell CRM Tables (Additive Only - No existing table modifications)
-- =============================================

-- 1. CRM Notes - Internal notes for clients and conversations
CREATE TABLE public.crm_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  conversation_id TEXT, -- Missive conversation ID (external)
  created_by_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  note_content TEXT NOT NULL,
  note_type TEXT NOT NULL DEFAULT 'internal' CHECK (note_type IN ('internal', 'system')),
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. CRM Activity Events - Timeline of all client activity
CREATE TABLE public.crm_activity_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('status_change', 'note_added', 'email_sent', 'email_received', 'conversation_linked', 'bulk_send')),
  old_value TEXT,
  new_value TEXT,
  metadata JSONB DEFAULT '{}',
  created_by_profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Missive Conversations - Cached conversation metadata
CREATE TABLE public.missive_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  missive_conversation_id TEXT NOT NULL UNIQUE,
  subject TEXT,
  snippet TEXT,
  participants JSONB DEFAULT '[]',
  last_message_at TIMESTAMPTZ,
  needs_reply BOOLEAN NOT NULL DEFAULT false,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Missive Conversation Links - Links conversations to clients
CREATE TABLE public.missive_conversation_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.missive_conversations(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  linked_by_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL DEFAULT 'manual' CHECK (link_type IN ('auto', 'manual')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(conversation_id, client_id)
);

-- 5. CRM Email Templates - Reusable email templates
CREATE TABLE public.crm_email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. CRM Bulk Send Logs - Log of bulk email sends
CREATE TABLE public.crm_bulk_send_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  template_id UUID REFERENCES public.crm_email_templates(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
  created_by_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- 7. CRM Bulk Send Recipients - Individual recipient status
CREATE TABLE public.crm_bulk_send_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bulk_send_id UUID NOT NULL REFERENCES public.crm_bulk_send_logs(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  error_message TEXT,
  sent_at TIMESTAMPTZ
);

-- 8. CRM Missive Settings - Per-tenant Missive configuration
CREATE TABLE public.crm_missive_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE CASCADE,
  from_email TEXT,
  from_name TEXT,
  is_connected BOOLEAN NOT NULL DEFAULT false,
  last_sync_at TIMESTAMPTZ,
  connection_status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================
-- Indexes for common query patterns
-- =============================================

CREATE INDEX idx_crm_notes_tenant_client ON public.crm_notes(tenant_id, client_id);
CREATE INDEX idx_crm_notes_created_at ON public.crm_notes(created_at DESC);

CREATE INDEX idx_crm_activity_events_tenant_client ON public.crm_activity_events(tenant_id, client_id);
CREATE INDEX idx_crm_activity_events_created_at ON public.crm_activity_events(created_at DESC);

CREATE INDEX idx_missive_conversations_tenant ON public.missive_conversations(tenant_id);
CREATE INDEX idx_missive_conversations_needs_reply ON public.missive_conversations(tenant_id, needs_reply) WHERE needs_reply = true;

CREATE INDEX idx_missive_conversation_links_client ON public.missive_conversation_links(client_id);

CREATE INDEX idx_crm_email_templates_tenant ON public.crm_email_templates(tenant_id);

CREATE INDEX idx_crm_bulk_send_logs_tenant ON public.crm_bulk_send_logs(tenant_id);

CREATE INDEX idx_crm_bulk_send_recipients_bulk_send ON public.crm_bulk_send_recipients(bulk_send_id);

-- =============================================
-- Enable Row Level Security on all tables
-- =============================================

ALTER TABLE public.crm_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_activity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.missive_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.missive_conversation_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_bulk_send_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_bulk_send_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_missive_settings ENABLE ROW LEVEL SECURITY;

-- =============================================
-- RLS Policies using existing tenant_memberships pattern
-- =============================================

-- CRM Notes policies
CREATE POLICY "Tenant members can view notes" ON public.crm_notes
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM public.tenant_memberships WHERE profile_id = auth.uid())
  );

CREATE POLICY "Staff can create notes" ON public.crm_notes
  FOR INSERT WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM public.tenant_memberships WHERE profile_id = auth.uid())
    AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff'))
  );

CREATE POLICY "Staff can update own notes" ON public.crm_notes
  FOR UPDATE USING (
    created_by_profile_id = auth.uid()
    AND tenant_id IN (SELECT tenant_id FROM public.tenant_memberships WHERE profile_id = auth.uid())
  );

CREATE POLICY "Staff can delete own notes" ON public.crm_notes
  FOR DELETE USING (
    created_by_profile_id = auth.uid()
    AND tenant_id IN (SELECT tenant_id FROM public.tenant_memberships WHERE profile_id = auth.uid())
  );

-- CRM Activity Events policies
CREATE POLICY "Tenant members can view activity" ON public.crm_activity_events
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM public.tenant_memberships WHERE profile_id = auth.uid())
  );

CREATE POLICY "Staff can create activity events" ON public.crm_activity_events
  FOR INSERT WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM public.tenant_memberships WHERE profile_id = auth.uid())
    AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff'))
  );

-- Missive Conversations policies
CREATE POLICY "Tenant members can view conversations" ON public.missive_conversations
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM public.tenant_memberships WHERE profile_id = auth.uid())
  );

CREATE POLICY "Staff can manage conversations" ON public.missive_conversations
  FOR ALL USING (
    tenant_id IN (SELECT tenant_id FROM public.tenant_memberships WHERE profile_id = auth.uid())
    AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff'))
  );

-- Missive Conversation Links policies
CREATE POLICY "Tenant members can view links" ON public.missive_conversation_links
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM public.tenant_memberships WHERE profile_id = auth.uid())
  );

CREATE POLICY "Staff can manage links" ON public.missive_conversation_links
  FOR ALL USING (
    tenant_id IN (SELECT tenant_id FROM public.tenant_memberships WHERE profile_id = auth.uid())
    AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff'))
  );

-- CRM Email Templates policies
CREATE POLICY "Tenant members can view templates" ON public.crm_email_templates
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM public.tenant_memberships WHERE profile_id = auth.uid())
  );

CREATE POLICY "Admins can manage templates" ON public.crm_email_templates
  FOR ALL USING (
    tenant_id IN (SELECT tenant_id FROM public.tenant_memberships WHERE profile_id = auth.uid())
    AND has_role(auth.uid(), 'admin')
  );

-- CRM Bulk Send Logs policies
CREATE POLICY "Tenant members can view bulk sends" ON public.crm_bulk_send_logs
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM public.tenant_memberships WHERE profile_id = auth.uid())
  );

CREATE POLICY "Admins can manage bulk sends" ON public.crm_bulk_send_logs
  FOR ALL USING (
    tenant_id IN (SELECT tenant_id FROM public.tenant_memberships WHERE profile_id = auth.uid())
    AND has_role(auth.uid(), 'admin')
  );

-- CRM Bulk Send Recipients policies
CREATE POLICY "Tenant members can view recipients" ON public.crm_bulk_send_recipients
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM public.tenant_memberships WHERE profile_id = auth.uid())
  );

CREATE POLICY "System can manage recipients" ON public.crm_bulk_send_recipients
  FOR ALL USING (
    tenant_id IN (SELECT tenant_id FROM public.tenant_memberships WHERE profile_id = auth.uid())
    AND has_role(auth.uid(), 'admin')
  );

-- CRM Missive Settings policies
CREATE POLICY "Tenant members can view settings" ON public.crm_missive_settings
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM public.tenant_memberships WHERE profile_id = auth.uid())
  );

CREATE POLICY "Admins can manage settings" ON public.crm_missive_settings
  FOR ALL USING (
    tenant_id IN (SELECT tenant_id FROM public.tenant_memberships WHERE profile_id = auth.uid())
    AND has_role(auth.uid(), 'admin')
  );

-- =============================================
-- Triggers for updated_at timestamps (using existing set_updated_at function)
-- =============================================

CREATE TRIGGER update_crm_notes_updated_at
  BEFORE UPDATE ON public.crm_notes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER update_missive_conversations_updated_at
  BEFORE UPDATE ON public.missive_conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER update_crm_email_templates_updated_at
  BEFORE UPDATE ON public.crm_email_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER update_crm_missive_settings_updated_at
  BEFORE UPDATE ON public.crm_missive_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();