# Isolated 5C finding: legacy donor transaction view bypasses tenant RLS

Baseline: `59f4bed9dec2cdb8ac35592ed4b15d4af379ad74` (CRM main).
Discovered during actual PostgreSQL 17.4 acceptance, October 17, 2026.
No production database was queried or changed.

## Reproduction and correction

The original `crm_donor_transactions_v` is an owner-executed view, with SELECT
granted to authenticated. It joins `givebutter_donations` to `crm_donors` by
provider contact ID or email. The donor table's own tenant-member RLS is bypassed
by the view. The source transactions do not have a tenant column or an approved
provider-source-to-tenant mapping.

In disposable run `4cf0651fdead41cd9fa3e85ec961d349`, a synthetic tenant-one
actor's direct donor-table SELECT returned tenant one only. The same actor's
view SELECT returned both tenants:

```text
Legacy view exposes other tenant:
['00000000-0000-0000-0000-000000000001',
 '00000000-0000-0000-0000-000000000002']
```

This was a real PostgreSQL RLS/view test with synthetic records, not a mocked
service response. It establishes the defect in repository source, not the
current deployment configuration.

Forward migration `20261017160127_restrict_legacy_donor_transaction_view.sql`
revokes browser/PUBLIC access to this global legacy view. Existing service-only
reads and tenant-scoped donor-table reads are preserved. No source ownership is
inferred from shared email/contact IDs; no historical records or legacy
processors, counters, automation events or campaign workflows are changed.

The deliberate contract is **view unavailable to browsers** until source
ownership has a separate reviewed design. Merely adding security_invoker would
not establish ownership of the global underlying transactions. The regression
asserts the corrected fail-closed contract rather than fabricating a mapping.

## Executed regression coverage

The Billing Hub 5C runner installs the exact donor table/view DDL excerpt and
current correction into its independently verified disposable PostgreSQL
cluster, alongside current CRM authorization helpers and synthetic memberships.
It deliberately does not install or invoke any legacy processor or outbound
workflow. `supabase/tests/legacy_donor_view_boundary.sql` is a reusable
rollback-only regression included by that runner.

The corrected checks passed in run `02a85ab8bafa4cc3b57ce6d7728b4e82`:

- Direct donor-table SELECT returns the authorized tenant only.
- Outsider table reads return no rows; anonymous reads are denied.
- Authenticated donor INSERT/UPDATE/DELETE are denied.
- Authenticated and anonymous view reads are denied by actual SQL operations;
  effective ACLs are checked, and service SELECT still returns the two synthetic
  fixture records.
- Donor ingest queue stays empty and donation_count totals remain zero. No
  processor RPC was called.

Full SQL/stdout/stderr are retained under Billing Hub's ignored
`acceptance-5b/runs/<run-id>/`; the cross-repository receipt and per-scenario
evidence index are in its 5C acceptance PR. The complete ten-group suite also
tests genuine GoTrue-signed identities over PostgREST and the actual report
handler. This SQL regression alone does not claim to validate JWT signatures.

Remaining boundary: source ownership, live legacy ingestion correctness and
browser transaction reporting remain unavailable/unverified. Re-enabling the
browser view requires an explicit ownership/security design. No migration was
applied remotely, and this fix is not merged or deployed.
