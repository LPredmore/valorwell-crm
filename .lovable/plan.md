

# Email Signatures Feature

## Overview

Add a signature management system that lets you create, store, and select email signatures -- both text-based and image-based -- and attach them to any outgoing email (standard emails and campaign emails).

## How It Works

### Signature Types

- **Text signatures**: HTML-formatted text (e.g., "Best regards, Dr. Smith, ValorWell Team") -- composed with the same rich text editor already in the app
- **Image signatures**: An uploaded image (e.g., your personal branded signature graphic) stored in Supabase Storage, rendered as an `<img>` tag in the email HTML

Each signature has a name (e.g., "My Personal Sig", "ValorWell Team"), a type (text or image), and the content (HTML string or image URL).

### Storage

- **New table**: `crm_email_signatures` with columns: `id`, `tenant_id`, `name`, `signature_type` (text/image), `body_html` (for text sigs -- stores the rich text HTML), `image_url` (for image sigs -- URL from Supabase Storage), `is_default` (boolean -- one signature can be the auto-selected default), `created_by_profile_id`, `created_at`, `updated_at`
- **New storage bucket**: `email-signatures` (public) for uploaded signature images
- **RLS policies**: Tenant-scoped read/write, matching the existing CRM table patterns

### Signature Management UI

A new "Email Signatures" panel on the Settings page (replacing the Phase 4 placeholder card). Features:
- List of existing signatures with name, type, and preview
- Create/edit dialog with:
  - Name field
  - Type toggle (Text / Image)
  - If Text: the RichTextEditor for composing the signature HTML
  - If Image: a file upload input that uploads to `email-signatures` bucket and stores the public URL
- Set one signature as default
- Delete signatures

### Signature Selection in Email Composition

Three integration points, all using the same pattern -- a small `Select` dropdown above the send button labeled "Signature":

1. **ReplyComposer** (inbox replies): Dropdown to pick a signature. When selected, the signature HTML is appended to the email body before sending. The default signature is pre-selected.

2. **BulkComposeDialog** (bulk emails): Same dropdown. Signature appended to `bodyHtml` before passing to `onSend`.

3. **CampaignStepEditor** (campaign email steps): A signature selector dropdown on email-type steps. The selected signature ID is stored on the step. When the campaign-scheduler edge function sends the email, it fetches the signature and appends it to the body HTML.

### How Signatures Get Into Emails

For standard emails (reply + bulk), the signature is appended client-side before the HTML is sent to the edge function. Simple string concatenation:

```text
finalBody = userBody + "<br><br>" + signatureHtml
```

For image signatures, `signatureHtml` is just `<img src="[public_url]" alt="Signature" style="max-width:600px">`.

For campaign emails, the signature ID is stored on the campaign step (new nullable column `signature_id` on `crm_campaign_steps`). The campaign-scheduler edge function looks up the signature at send time and appends it after personalization.

## Technical Details

### Database Migration

```sql
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
```

### New Files

- `src/hooks/crm/useEmailSignatures.ts` -- CRUD hook for signatures (query + mutations for create, update, delete, set default)
- `src/components/crm/settings/EmailSignaturesPanel.tsx` -- Settings panel with list + create/edit dialog
- `src/components/crm/shared/SignatureSelect.tsx` -- Reusable dropdown for picking a signature, used in all three composition surfaces

### Modified Files

- `src/pages/crm/Settings.tsx` -- Replace "Phase 4" placeholder card with `EmailSignaturesPanel`
- `src/components/crm/inbox/ReplyComposer.tsx` -- Add `SignatureSelect`, append signature before sending
- `src/components/crm/bulk/BulkComposeDialog.tsx` -- Add `SignatureSelect`, append signature before sending
- `src/components/crm/campaigns/CampaignStepEditor.tsx` -- Add `SignatureSelect` for email steps, store `signature_id`
- `src/lib/crm/campaign-types.ts` -- Add `signature_id` to `CampaignStepFormData` and `CrmCampaignStep`
- `supabase/functions/campaign-scheduler/index.ts` -- Fetch signature by ID at send time, append to email body
- `src/hooks/crm/useCampaignSteps.ts` -- Include `signature_id` in step save/load

### What Does NOT Change

- No existing table columns modified
- No existing enum changes
- All existing email sending logic stays the same -- signatures are just HTML appended to the body
- SMS is unaffected (signatures are email-only)

