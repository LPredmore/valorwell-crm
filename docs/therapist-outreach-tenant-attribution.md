# Therapist outreach prospect tenant attribution

Billing Hub migration `20261009231905_tenant_scope_therapist_outreach_prospects` was applied on October 9, 2026. It backfilled the 1,279 historical therapist outreach staging rows to the sole existing tenant, **ValorWell**.

## Contract for all new importers

`public.therapist_outreach_prospects.tenant_id` is a **required, non-null UUID** referencing `public.tenants(id)`. There is **no database default**. Any import, Edge Function, background worker, CSV load or service-role upsert that omits `tenant_id` will now be rejected. All ingestion code must obtain the tenant from an authenticated, server-trusted job configuration, not from client-supplied metadata or a global hardcoded ValorWell fallback.

Duplicates are merged only within the same tenant (existing trigger now checks `p.tenant_id = new.tenant_id`); LinkedIn uniqueness is also tenant-scoped. Do not recreate global deduplication rules.

**Access:** This remains a service-role-only staging table. Do not grant `authenticated` or `anon` direct SELECT/INSERT/UPDATE, and do not add permissive RLS policies. Read-only reporting and any future pipeline import need a separate authorization review and tenant-filtered, server-side adapter.

**Outreach:** Tenant attribution does not mean permission to import, send email or bypass suppression. `outreach_contactable`, exclusions, duplicate identity resolution, and ~1,039 missing email addresses still require independent reconciliation. No automatic mass prospect import or send was part of this migration.

## Verification

- 1,279 of 1,279 rows have the ValorWell tenant UUID; 0 null IDs
- column is NOT NULL with no default and foreign key references tenants(id)
- RLS remains enabled and anon/authenticated SELECT remains denied
- dedupe trigger reads candidates only from the same tenant
- tenant-scoped unique LinkedIn and (tenant_id,created_at,id) indexes exist
- historical `updated_at` was not touched by attribution

**Rollback:** Do not simply drop the column once more than one tenant has records. Pause imports and export/audit row ownership first; reverting tenant-aware dedupe and uniqueness would again permit cross-tenant collisions.
