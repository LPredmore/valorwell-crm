-- DEVELOPMENT CANDIDATE ONLY. Not an automatic migration or production approval.
-- Supersedes the capability-only candidate for native tenant-isolation testing.
-- Public reads and flat object paths remain. Writes require trusted current tenant,
-- matching object user_metadata.tenant_id, membership and CRM write capability.
-- Legacy untagged objects fail closed for writes. An owner-reviewed attribution
-- plan is required before any rollout; do not guess tenants or backfill production.
-- All upload clients for these buckets must supply tenant metadata before rollout.
BEGIN;
DROP POLICY IF EXISTS "Authenticated users can upload logos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update logos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete logos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload training covers" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update training covers" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete training covers" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload signature images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete signature images" ON storage.objects;
DROP POLICY IF EXISTS "email_signatures_crm_insert" ON storage.objects;
DROP POLICY IF EXISTS "email_signatures_crm_update" ON storage.objects;
DROP POLICY IF EXISTS "email_signatures_crm_delete" ON storage.objects;
CREATE POLICY crm_public_assets_tenant_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id IN ('org-logos','training-covers','email-signatures')
  AND user_metadata->>'tenant_id' = auth.jwt()->'app_metadata'->>'current_tenant_id'
  AND EXISTS (
    SELECT 1 FROM public.crm_user_capabilities capability
    JOIN public.tenant_memberships membership
      ON membership.profile_id = capability.profile_id
     AND membership.tenant_id = capability.tenant_id
    WHERE capability.profile_id = (SELECT auth.uid())
      AND capability.tenant_id::text = user_metadata->>'tenant_id'
      AND capability.crm_role::text IN ('crm_admin','crm_operator')
  ))
;
CREATE POLICY crm_public_assets_tenant_update ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id IN ('org-logos','training-covers','email-signatures')
  AND user_metadata->>'tenant_id' = auth.jwt()->'app_metadata'->>'current_tenant_id'
  AND EXISTS (
    SELECT 1 FROM public.crm_user_capabilities capability
    JOIN public.tenant_memberships membership
      ON membership.profile_id = capability.profile_id
     AND membership.tenant_id = capability.tenant_id
    WHERE capability.profile_id = (SELECT auth.uid())
      AND capability.tenant_id::text = user_metadata->>'tenant_id'
      AND capability.crm_role::text IN ('crm_admin','crm_operator')
  ))
WITH CHECK (bucket_id IN ('org-logos','training-covers','email-signatures')
  AND user_metadata->>'tenant_id' = auth.jwt()->'app_metadata'->>'current_tenant_id'
  AND EXISTS (
    SELECT 1 FROM public.crm_user_capabilities capability
    JOIN public.tenant_memberships membership
      ON membership.profile_id = capability.profile_id
     AND membership.tenant_id = capability.tenant_id
    WHERE capability.profile_id = (SELECT auth.uid())
      AND capability.tenant_id::text = user_metadata->>'tenant_id'
      AND capability.crm_role::text IN ('crm_admin','crm_operator')
  ))
;
CREATE POLICY crm_public_assets_tenant_delete ON storage.objects FOR DELETE TO authenticated
USING (bucket_id IN ('org-logos','training-covers','email-signatures')
  AND user_metadata->>'tenant_id' = auth.jwt()->'app_metadata'->>'current_tenant_id'
  AND EXISTS (
    SELECT 1 FROM public.crm_user_capabilities capability
    JOIN public.tenant_memberships membership
      ON membership.profile_id = capability.profile_id
     AND membership.tenant_id = capability.tenant_id
    WHERE capability.profile_id = (SELECT auth.uid())
      AND capability.tenant_id::text = user_metadata->>'tenant_id'
      AND capability.crm_role::text IN ('crm_admin','crm_operator')
  ))
;
COMMIT;
