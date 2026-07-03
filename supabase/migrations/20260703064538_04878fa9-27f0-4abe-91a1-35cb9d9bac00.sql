
CREATE TABLE public.crm_clickup_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  status text NOT NULL DEFAULT 'queued',
  total integer NOT NULL DEFAULT 0,
  processed integer NOT NULL DEFAULT 0,
  created_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  recreated_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  last_error text NULL,
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  triggered_by uuid NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.crm_clickup_sync_runs TO authenticated;
GRANT ALL ON public.crm_clickup_sync_runs TO service_role;

ALTER TABLE public.crm_clickup_sync_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view their sync runs"
  ON public.crm_clickup_sync_runs
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.tenant_memberships tm
      WHERE tm.profile_id = auth.uid() AND tm.tenant_id = crm_clickup_sync_runs.tenant_id
    )
  );

CREATE INDEX crm_clickup_sync_runs_tenant_started_idx
  ON public.crm_clickup_sync_runs (tenant_id, started_at DESC);

CREATE INDEX crm_clickup_sync_runs_status_idx
  ON public.crm_clickup_sync_runs (status);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER crm_clickup_sync_runs_set_updated_at
  BEFORE UPDATE ON public.crm_clickup_sync_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_clickup_sync_runs;
ALTER TABLE public.crm_clickup_sync_runs REPLICA IDENTITY FULL;
