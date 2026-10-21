# Storage write ACL hardening — issue #201 (source-only, 2026-10-21)

Security follow-up to GitHub issue LPredmore/valorwell-crm#201. **No production
SQL was run, no storage object or role was touched, nothing was deployed or
merged.** CRM PR #200 source work is preserved and untouched.

## Call-site trace (this repository, exhaustive)

| Bucket | Frontend writes | Edge Function writes | Policy source in this repo |
|---|---|---|---|
| `email-signatures` | `src/components/crm/settings/EmailSignaturesPanel.tsx` (`supabase.storage.from('email-signatures').upload(path, file)`, flat `crypto.randomUUID().ext` path, browser client with user JWT). No delete/update call site. | none | `supabase/migrations/20260212184121_...sql` (bucket + 3 legacy policies) |
| `email-assets` | `src/features/email-studio/templates/api.ts` (tenant-UUID folder paths) | none | `supabase/migrations/20260723164221_email_studio_database_foundation.sql` — already tenant/capability-gated via `crm_user_capabilities`; **do not weaken** |
| `org-logos` | **none** | **none** | **none** |
| `training-covers` | **none** | **none** | **none** |

`social-media-manager/handlers/thumbnails.ts` uses storage via the service
role for YouTube thumbnails — unrelated to these buckets.

## Why the paths look the way they do

- `email-signatures`: the only uploader ever written (`EmailSignaturesPanel`)
  generates flat `uuid.ext` names with no tenant folder. The single production
  object matches that convention.
- `training-covers` (6 flat objects) and `org-logos` (1 object under a UUID
  folder): **no call site exists in this repository.** Their writers and
  policies live in other ecosystem apps (Clients/Staff/Billing) or were
  created out-of-band. The UUID folder on the org-logos object is consistent
  with a per-tenant or per-user prefix convention in whichever app owns it —
  that cannot be confirmed from CRM source.

## Vulnerability (email-signatures, confirmed from source + audit)

The legacy INSERT/DELETE policies are `TO PUBLIC` gated only by
`auth.role()='authenticated'` and `bucket_id`. Because this Supabase project is
shared by the whole ecosystem, **any authenticated user of any app** (Clients,
Staff, CRM read-only users, `crm_none`) can upload, overwrite-path, or delete
any signature image. No UPDATE policy exists at all.

## Fix delivered (source-only)

`supabase/verification/email_signatures_storage_acl_hardening.sql`
(forward-only, staged outside `supabase/migrations/` so no tooling
auto-applies it):

- Drops the three legacy policies by exact name.
- Re-creates public `SELECT` unchanged (bucket is public by design — signature
  images render in outgoing email).
- New INSERT / UPDATE / DELETE policies `TO authenticated` requiring
  `EXISTS crm_user_capabilities(profile_id = auth.uid(), crm_role IN
  (crm_admin, crm_operator))` — the production-proven email-assets pattern.
  UPDATE carries both `USING` and `WITH CHECK`.
- **No folder predicate.** Existing flat paths and the current upload flow
  keep working; legitimate uploaders (CRM Settings users) already hold
  admin/operator capabilities.

Tests:

- `src/test/email-signatures-storage-acl.test.ts` — 9 offline static
  regressions (legacy drops, public-read preserved, capability gating on all
  three writes, UPDATE USING+WITH CHECK, no PUBLIC/anon write, no folder
  predicate, no managed-role/bucket collateral, contract coverage).
- `supabase/tests/email_signatures_storage_acl_contract.sql` — operator-run
  read-only catalog check (6 PASS rows) for the authorized isolated stack.

Residual risk accepted and documented: two CRM admins in *different* tenants
can still overwrite each other's flat-path objects, because flat paths carry
no tenant metadata. Closing that requires a path migration (move objects to
tenant folders + update `crm_email_signatures.image_url`) — a data-touching
change explicitly out of scope here. The capability gate removes the actual
reported hole: writes by non-CRM and read-only principals.

## Blocker: org-logos and training-covers

Safe identity mapping **cannot be established from this repository** — there
are no call sites, no policies, and no ownership metadata for these buckets in
CRM source. Authoring a tenant/capability policy blind could break the
unknown owning app's uploads; authoring a blanket revoke would definitely
break them. Per the issue's own constraint, **no migration is generated for
these buckets.**

Recommended next steps (owning app, not CRM):

1. Identify the owning app and its exact upload path convention (the UUID
   folder on the org-logos object suggests a prefix already exists).
2. If paths carry a tenant/user prefix, mirror the `profile-images`
   (`auth.uid()` folder) or `email-assets` (`crm_user_capabilities` folder)
   pattern.
3. If paths are flat with no recoverable ownership, route writes through a
   server-owned Edge Function with explicit authorization (service role stays
   server-side) and revoke direct authenticated writes.
4. Before any change, run the issue #201 real signed-user Storage API
   reproduction (synthetic object, authorized sandbox) to confirm the
   cross-tenant write is actually exploitable and afterwards that it is not.

## Deployment / backout (when separately approved)

- Deploy: operator applies the staged SQL on the target environment, then runs
  `supabase/tests/email_signatures_storage_acl_contract.sql` (expect 6 PASS),
  then the signed-user allow/deny matrix (CRM admin upload PASS, cross-tenant
  non-admin INSERT/UPDATE/DELETE DENY, anon DENY, public SELECT PASS).
- Backout: re-create the three legacy policies exactly as in
  `20260212184121` (documented there; no separate backout file needed).
- Deploy-time recommendation (not in SQL, `storage.buckets` writes are
  tool-only): add `file_size_limit` and `allowed_mime_types` to
  `email-signatures` matching the email-assets bucket (5 MB, jpeg/png/webp/gif)
  via the storage bucket update tool.

## Explicit non-claims

- Not applied to production or any branch; not deployed; not merged.
- The catalog contract and static tests do not prove signed-user behavior —
  the issue #201 real-actor reproduction remains a release gate.
- `storage.objects` is owned by `supabase_storage_admin`; no role grants or
  managed-schema changes were made or are required by the staged SQL.
