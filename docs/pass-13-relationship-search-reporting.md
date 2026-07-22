# Pass 13 — Relationship search, reporting, and dashboards

## Scope

Pass 13 adds tenant-scoped operational search and reporting for the non-clinical Business Development relationship domain.

It includes:

- Generated weighted `tsvector` search documents on organizations, contacts, opportunities, and campaigns.
- GIN indexes for each relationship search document.
- Security-invoker organization, contact, opportunity, campaign, reply, and metrics read models.
- Authenticated tenant-scoped `search_relationships` and `get_relationship_report_metrics` RPCs.
- Unified CRM search across relationship organizations, contacts, BTY opportunities, and relationship campaigns.
- Current operational metrics and selected-period outreach metrics.
- A Business Development reports page and verified dashboard metric cards.
- Explicit unavailable-versus-zero behavior.

## Security boundary

Search and reporting functions are `SECURITY INVOKER`, use a fixed empty search path, and accept no tenant identifier from the caller. The current tenant is derived from the authenticated CRM operating context. Existing table RLS remains the row-level authority.

Anonymous execution is revoked. Authenticated execution is limited to CRM users with current tenant access; the reporting RPC additionally requires the operating context's reporting capability.

No materialized search or reporting view is used. Clinical clients, clinical campaigns, clinical communications, billing records, and Creator & Community Interest remain outside these read models.

## Truthful metrics

A numeric `0` is a verified result and is displayed as zero. Missing capability, permission failures, query failures, and missing metric contracts remain explicitly unavailable and are never converted to zero.

Current-state metrics include review queues, opportunity qualification, overdue next actions, unassigned relationships, active campaigns, actionable replies, import conflicts, recent updates, inventory, and active suppressions.

Selected-period metrics include outbound messages, deliveries, failed or bounced messages, inbound replies, enrollments, unique contacts reached, and reply rate.

## Compatibility repair

Existing relationship contact self-service RLS policies reference `website_intake_tenant_id()`. The helper's authenticated execute privilege had previously been revoked, causing security-invoker contact reads to fail during policy evaluation. Pass 13 restores authenticated execution only for that non-sensitive tenant-ID helper. Anonymous direct execution remains revoked.

## Verification

The live database verification covers:

- 19 metric contracts returned under the real CRM admin identity.
- `total_contacts = 87` from current Billing Hub records.
- Verified zero values for campaigns and reply rate.
- Real contact search results and pagination.
- Empty search returning no bulk directory.
- Unsupported record kinds rejected.
- Anonymous search and reporting execution denied.
- Security-invoker view and function configuration.
- Generated search columns and GIN indexes.
- No production campaign execution or delivery gate changes.

Pass 14 remains responsible for cross-application regression, representative query-plan capture, accessibility review, failure-recovery drills, final release audit, and controlled production activation.
