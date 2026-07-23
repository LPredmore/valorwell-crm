# Pass 14 — Production Hardening and Final Acceptance

## Decision

The non-clinical Business Development relationship implementation is eligible for final technical acceptance after the exact-head repository checks complete.

Production delivery remains **locked / no-go**. Acceptance does not activate campaigns, enrollments, providers, workers, webhooks, or outbound delivery.

## Hard boundaries

- Canonical database: Billing Hub Supabase project `ahqauomkgflopxgnlndd`.
- Canonical application: `LPredmore/valorwell-crm`.
- Clinical clients, clinical campaigns, clinical communications, appointments, billing, credentialing, and Creator & Community Interest remain separate domains.
- No destructive cleanup or cross-domain schema change is included.

## Database hardening

- Added the private `crm_has_relationship_permission` RLS helper and canonical `crm_admin`, `crm_operator`, and `crm_readonly` policy layer.
- Preserved legacy staff/admin access and profile-linked website/self-service policies.
- Converted all six relationship reporting views to SELECT-only read models.
- Removed direct API execution from relationship trigger functions while preserving trigger execution.
- Published a versioned `crm_domain_contracts` release record containing capability, object, RPC, grant, policy, and schema-fingerprint evidence.
- The release contract separates `release_status` from `activation_status`.

## Authorization and compatibility evidence

Transaction-scoped rollback testing verified:

- CRM operator same-tenant read and write.
- CRM read-only same-tenant read with mutation denial.
- Cross-tenant relationship isolation.
- Anonymous relationship table denial.
- The single-purpose anonymous unsubscribe RPC remains available.
- Existing profile-linked self-service select and update behavior remains intact.
- Trigger-based audit mutation still executes after direct RPC grants were revoked.
- All fixtures were rolled back and production counts remained unchanged.

## Worker, delivery, webhook, and recovery evidence

The deployed `relationship-campaign-worker`:

- Requires the service-role credential.
- Claims work through `FOR UPDATE SKIP LOCKED` leases.
- Reclaims expired leases and respects retry ceilings.
- Revalidates current safety and provider readiness before creating a canonical communication.
- Uses provider idempotency keys and records success or failure transactionally.
- Cannot enable campaign, enrollment, or provider gates.

The deployed `relationship-resend-webhook`:

- Validates signed Svix identifiers, timestamps, and HMAC signatures.
- Rejects stale signatures.
- Uses replay-safe provider-event and inbound-reply ingestion.
- Does not guess when reply matching is ambiguous; unmatched replies remain in the operator queue.
- Converts complaints and permanent bounces into suppression and stop behavior.

## Representative query plans

The release audit captured index-backed plans for:

- Contact full-text search through `relationship_contacts_search_document_gin`.
- Due-work claiming through `relationship_campaign_work_items_due_idx` with row locking.
- New-reply queue retrieval through `relationship_replies_tenant_queue_idx`.
- Active email suppression lookup through `relationship_suppressions_email_idx`.
- Opportunity pipeline retrieval remained index-backed. Because the live opportunity table is empty, selectivity and sort behavior must be rechecked with pilot-scale data before activation.

## Application and accessibility

The System Status page now:

- Loads the live Billing Hub release contract.
- Separates implementation acceptance from production activation.
- Fails closed when the contract is unavailable.
- Lists activation blockers with semantic headings and lists.
- Uses `role="status"`, `role="alert"`, meaningful text labels, and decorative-icon hiding where appropriate.
- Does not rely on color alone to communicate readiness.

## Activation blockers

Production activation remains prohibited until all of the following are independently verified and recorded:

1. Delivery provider configuration exists.
2. Outbound sender identity is verified.
3. Inbound reply route is verified.
4. Provider webhook is verified.
5. Delivery worker execution is verified.
6. A limited pilot campaign is explicitly approved.
7. Pilot-scale query plans and operational monitoring are rechecked.

## Rollback

The Pass 14 schema changes are additive. Activation remains locked at the database level. A rollback does not require deleting relationship data or modifying clinical systems. The release contract can be moved to `rejected` or `suspended`, while campaign execution, enrollment delivery, and provider readiness remain independently gated.
