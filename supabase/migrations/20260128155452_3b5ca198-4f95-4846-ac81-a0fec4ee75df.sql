-- Create crm_kanban_config table for per-tenant Kanban column configuration
CREATE TABLE public.crm_kanban_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  visible_statuses TEXT[] NOT NULL DEFAULT ARRAY[
    'Interested', 'New', 'No Insurance', 'Manual Check', 'Waitlist', 
    'Matching', 'Registered', 'Unscheduled', 'Scheduled', 
    'Early Sessions', 'Established', 'Inactive', 'Blacklisted', 'DNC'
  ]::TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT crm_kanban_config_tenant_unique UNIQUE (tenant_id)
);

-- Enable RLS
ALTER TABLE public.crm_kanban_config ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
-- All authenticated tenant members can read their tenant's config
CREATE POLICY "Tenant members can view kanban config"
ON public.crm_kanban_config
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.tenant_memberships
    WHERE tenant_memberships.tenant_id = crm_kanban_config.tenant_id
    AND tenant_memberships.profile_id = auth.uid()
  )
);

-- Only admins can insert config
CREATE POLICY "Admins can insert kanban config"
ON public.crm_kanban_config
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin') AND
  EXISTS (
    SELECT 1 FROM public.tenant_memberships
    WHERE tenant_memberships.tenant_id = crm_kanban_config.tenant_id
    AND tenant_memberships.profile_id = auth.uid()
  )
);

-- Only admins can update config
CREATE POLICY "Admins can update kanban config"
ON public.crm_kanban_config
FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') AND
  EXISTS (
    SELECT 1 FROM public.tenant_memberships
    WHERE tenant_memberships.tenant_id = crm_kanban_config.tenant_id
    AND tenant_memberships.profile_id = auth.uid()
  )
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin') AND
  EXISTS (
    SELECT 1 FROM public.tenant_memberships
    WHERE tenant_memberships.tenant_id = crm_kanban_config.tenant_id
    AND tenant_memberships.profile_id = auth.uid()
  )
);

-- Add updated_at trigger
CREATE TRIGGER set_crm_kanban_config_updated_at
BEFORE UPDATE ON public.crm_kanban_config
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- Add index for tenant lookup
CREATE INDEX idx_crm_kanban_config_tenant ON public.crm_kanban_config(tenant_id);