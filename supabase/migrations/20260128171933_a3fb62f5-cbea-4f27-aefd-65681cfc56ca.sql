-- HelpScout Integration Tables
-- Phase 3A: Foundation

-- 1. HelpScout Settings Table (per-tenant configuration)
CREATE TABLE public.crm_helpscout_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  mailbox_id TEXT,
  from_name TEXT,
  from_email TEXT,
  connection_status TEXT NOT NULL DEFAULT 'disconnected',
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT crm_helpscout_settings_tenant_unique UNIQUE (tenant_id)
);

-- 2. Conversation-Client Links Table
CREATE TABLE public.crm_conversation_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  helpscout_conversation_id TEXT NOT NULL,
  linked_by_profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  link_type TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT crm_conversation_links_unique UNIQUE (tenant_id, helpscout_conversation_id)
);

-- 3. Conversation Cache Table (for performance)
CREATE TABLE public.crm_conversation_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  helpscout_conversation_id TEXT NOT NULL,
  subject TEXT,
  status TEXT,
  customer_email TEXT,
  customer_name TEXT,
  preview_text TEXT,
  last_thread_at TIMESTAMPTZ,
  needs_reply BOOLEAN DEFAULT false,
  cached_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT crm_conversation_cache_unique UNIQUE (tenant_id, helpscout_conversation_id)
);

-- Enable RLS
ALTER TABLE public.crm_helpscout_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_conversation_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_conversation_cache ENABLE ROW LEVEL SECURITY;

-- RLS Policies for crm_helpscout_settings
CREATE POLICY "Users can view their tenant's HelpScout settings"
  ON public.crm_helpscout_settings FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_memberships 
      WHERE profile_id = auth.uid()
    )
  );

CREATE POLICY "Admins can manage their tenant's HelpScout settings"
  ON public.crm_helpscout_settings FOR ALL
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_memberships 
      WHERE profile_id = auth.uid()
    )
    AND public.has_role(auth.uid(), 'admin')
  );

-- RLS Policies for crm_conversation_links
CREATE POLICY "Users can view their tenant's conversation links"
  ON public.crm_conversation_links FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_memberships 
      WHERE profile_id = auth.uid()
    )
  );

CREATE POLICY "Staff can manage their tenant's conversation links"
  ON public.crm_conversation_links FOR ALL
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_memberships 
      WHERE profile_id = auth.uid()
    )
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'))
  );

-- RLS Policies for crm_conversation_cache
CREATE POLICY "Users can view their tenant's conversation cache"
  ON public.crm_conversation_cache FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_memberships 
      WHERE profile_id = auth.uid()
    )
  );

CREATE POLICY "Staff can manage their tenant's conversation cache"
  ON public.crm_conversation_cache FOR ALL
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_memberships 
      WHERE profile_id = auth.uid()
    )
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'))
  );

-- Indexes for performance
CREATE INDEX idx_crm_conversation_links_client ON public.crm_conversation_links(client_id);
CREATE INDEX idx_crm_conversation_links_conversation ON public.crm_conversation_links(helpscout_conversation_id);
CREATE INDEX idx_crm_conversation_cache_conversation ON public.crm_conversation_cache(helpscout_conversation_id);
CREATE INDEX idx_crm_conversation_cache_needs_reply ON public.crm_conversation_cache(tenant_id, needs_reply) WHERE needs_reply = true;

-- Triggers for updated_at
CREATE TRIGGER set_crm_helpscout_settings_updated_at
  BEFORE UPDATE ON public.crm_helpscout_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();