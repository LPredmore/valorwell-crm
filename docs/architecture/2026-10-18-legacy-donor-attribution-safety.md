# Retired Givebutter source ownership: fail-closed boundary

2026-10-18 live audit identified no `tenant_id` in
`public.givebutter_donations`. Existing `crm_donor_overview()` included
`totalDonations` = a global unrestricted count despite using a tenant
context for its other metrics. Existing `crm_enqueue_donor_transactions`
selected global transaction IDs and assigned them to the current CRM tenant
without independent ownership evidence.

This forward-only migration **preserves all records**, tenant-scoped counts
and legacy queue contents. It returns a nullable totalDonations plus explicit
`totalDonationsStatus` for the unavailable historical total, and fails
closed on new legacy queue replays. This deliberately disables unsafe
historical re-enqueue; it does NOT disable Zeffy, normal CRM donor reads, or
existing ingest queue workers.

Before deployment check all caller UI can render null without interpreting
it as zero, including exports and reports. Run two-tenant signed JWT synthetic
tests for disjoint and overlapping donor identities and validate no new
queue records on attempted historical replays. Do not re-enable ingestion
until an audited, immutable per-transaction tenant ownership map and
tenant-scoped replay query have been implemented, with separate regression
proof. Never guess ownership from donor name/email alone.
