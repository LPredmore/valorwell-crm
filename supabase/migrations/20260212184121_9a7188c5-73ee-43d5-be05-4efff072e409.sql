
-- Signatures table
CREATE TABLE crm_email_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  signature_type TEXT NOT NULL CHECK (signature_type IN ('text', 'image')),
  body_html TEXT,
  image_url TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_by_profile_id UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trigger for updated_at
CREATE TRIGGER set_updated_at_crm_email_signatures
  BEFORE UPDATE ON crm_email_signatures
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS
ALTER TABLE crm_email_signatures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view signatures"
  ON crm_email_signatures FOR SELECT
  USING (tenant_id IN (
    SELECT tenant_id FROM tenant_memberships WHERE profile_id = auth.uid()
  ));

CREATE POLICY "Tenant members can manage signatures"
  ON crm_email_signatures FOR ALL
  USING (tenant_id IN (
    SELECT tenant_id FROM tenant_memberships WHERE profile_id = auth.uid()
  ));

-- Add signature_id to campaign steps
ALTER TABLE crm_campaign_steps
  ADD COLUMN signature_id UUID REFERENCES crm_email_signatures(id);

-- Storage bucket for signature images
INSERT INTO storage.buckets (id, name, public)
VALUES ('email-signatures', 'email-signatures', true);

-- Storage policies
CREATE POLICY "Authenticated users can upload signature images"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'email-signatures' AND auth.role() = 'authenticated');

CREATE POLICY "Anyone can view signature images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'email-signatures');

CREATE POLICY "Authenticated users can delete signature images"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'email-signatures' AND auth.role() = 'authenticated');
