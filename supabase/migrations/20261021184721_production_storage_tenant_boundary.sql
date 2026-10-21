-- Legacy untagged assets retain reads; deny writes until verified attribution.
-- Forward-only deployment envelope. Historical files/ledger remain unchanged.
-- Apply only this new version, not the superseded historical source files.
-- Prerequisites/recovery: docs/production-completion-2026-10-21.md.
BEGIN;
DO $preflight$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261020214527') THEN
  RAISE EXCEPTION 'Expected reviewed production baseline 20261020214527';
 END IF;
END $preflight$;
DO $policy_drift$
BEGIN
 IF (SELECT encode(sha256(convert_to(string_agg(row_to_json(p)::text,E'\n' ORDER BY policyname),'UTF8')),'hex') FROM pg_policies p WHERE schemaname='storage' AND tablename='objects') IS DISTINCT FROM 'ff2f05e571e7131076f7bb82be5dc2fbb29b94b59ac9c02acdb658644fd34b76' THEN
  RAISE EXCEPTION 'Storage policy catalog drift: review permissive policy composition before release';
 END IF;
END $policy_drift$;

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
