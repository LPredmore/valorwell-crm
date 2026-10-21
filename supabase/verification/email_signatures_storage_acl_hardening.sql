-- Security hardening: email-signatures Storage write ACL (GitHub issue #201)
--
-- SOURCE-ONLY / FORWARD-ONLY. This file is staged for review and operator
-- application on an authorized isolated stack. Do NOT apply to production
-- without the explicit release approval and signed-user reproduction
-- required by issue #201. It deliberately lives outside supabase/migrations/
-- so no tooling auto-applies it.
--
-- Diagnosis (production read-only audit, 2026-10-21):
--   The legacy policies created by 20260212184121 predicate writes on
--   bucket_id alone. INSERT/DELETE are TO PUBLIC gated only by
--   auth.role()='authenticated', so ANY authenticated user of the shared
--   Billing Hub database (including non-CRM Clients/Staff app users) can
--   upload or delete any object in the bucket. No UPDATE policy exists.
--
-- Design constraints:
--   * The bucket is publicly readable by design (signature <img> tags in
--     outgoing email). Public SELECT is preserved unchanged.
--   * Existing production objects use FLAT legacy paths (no tenant folder),
--     and the CRM uploader (EmailSignaturesPanel) writes flat uuid.ext paths.
--     A tenant-folder predicate like email-assets uses would break the
--     existing object and the current upload flow, so this migration gates
--     WHO may write (CRM admin/operator capability) instead of WHICH folder.
--   * Identity mapping: public.crm_user_capabilities (profile_id, tenant_id,
--     crm_role) with self-select RLS — the same production-proven pattern as
--     the email-assets policies in 20260723164221.
--   * storage.objects is owned by supabase_storage_admin; policy changes are
--     the supported mechanism. No role grants or managed-schema changes here.

-- 1. Remove the legacy bucket-wide write policies (exact legacy names).
DROP POLICY IF EXISTS "Authenticated users can upload signature images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete signature images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view signature images" ON storage.objects;

-- 2. Public read preserved (bucket is public; signature images render in email).
CREATE POLICY email_signatures_public_select
ON storage.objects
FOR SELECT TO PUBLIC
USING (bucket_id = 'email-signatures');

-- 3. Writes require an active CRM admin/operator capability for the caller.
--    No folder predicate: flat legacy object paths must keep working.
CREATE POLICY email_signatures_crm_insert
ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'email-signatures'
  AND EXISTS (
    SELECT 1
    FROM public.crm_user_capabilities capability
    WHERE capability.profile_id = (SELECT auth.uid())
      AND capability.crm_role = ANY (ARRAY[
        'crm_admin'::public.crm_capability_role,
        'crm_operator'::public.crm_capability_role
      ])
  )
);

CREATE POLICY email_signatures_crm_update
ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'email-signatures'
  AND EXISTS (
    SELECT 1
    FROM public.crm_user_capabilities capability
    WHERE capability.profile_id = (SELECT auth.uid())
      AND capability.crm_role = ANY (ARRAY[
        'crm_admin'::public.crm_capability_role,
        'crm_operator'::public.crm_capability_role
      ])
  )
)
WITH CHECK (
  bucket_id = 'email-signatures'
  AND EXISTS (
    SELECT 1
    FROM public.crm_user_capabilities capability
    WHERE capability.profile_id = (SELECT auth.uid())
      AND capability.crm_role = ANY (ARRAY[
        'crm_admin'::public.crm_capability_role,
        'crm_operator'::public.crm_capability_role
      ])
  )
);

CREATE POLICY email_signatures_crm_delete
ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'email-signatures'
  AND EXISTS (
    SELECT 1
    FROM public.crm_user_capabilities capability
    WHERE capability.profile_id = (SELECT auth.uid())
      AND capability.crm_role = ANY (ARRAY[
        'crm_admin'::public.crm_capability_role,
        'crm_operator'::public.crm_capability_role
      ])
  )
);
