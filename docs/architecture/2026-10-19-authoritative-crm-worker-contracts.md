# Authoritative CRM worker contract corrections

The recovered October 19 catalog exposes `tenant_memberships.profile_id`.
The reviewed campaign lifecycle migration queries `user_id`, so valid enrollment
fails with an undefined-column error before checking CRM capability. The separate
follow-on `20261019165842_crm_campaign_membership_profile_contract.sql` replaces
only that predicate in the installed function. It requires the reviewed operator
check, rejects unknown drift, is idempotent, and preserves the function owner and
ACL. The original nine rollout files remain unchanged. Deploy this follow-on only
after the lifecycle migration, as a separately reviewed rollout item. It is
independent of Billing's separate claim-status authorization correction.

The relationship claim RPC returns a trusted `tenantId` for each leased work item.
The worker previously looked up its communication, step and reply root using a
fixed default tenant. Valid work for another tenant was marked for retry without
contacting the provider. These lookups now use the leased work's tenant. Neither
request-body tenant IDs nor provider payloads select that scope.

The opt-in acceptance runner in `scripts/worker-integration` exercises actual
checked-in Edge handlers through the Supabase SDK and signed JWTs over a Unix
socket to a network-disabled PostgREST/database environment. Synthetic provider
responses cover delivery, transient failure, stable retry idempotency, delayed
follow-up threading and inbound reply signature verification/correlation.
Enrollment, rule evaluation, event/job creation, concurrent trigger claims,
suppression, cancellation, scheduling, audits, tenant denials and internal social
queue authorization execute in PostgreSQL. No provider transport can publish or
send a real message. The database fixtures do not relax triggers or constraints.

Local acceptance does not prove hosted signed-in access, provider delivery, or
production deployment approval. Production database migrations and Edge Function
deployment remain pending explicit release review.

Definitive exact-cluster acceptance passed 15/15 tests (14 scenario groups),
with no skips. The restored database has production-equivalent postgres role
flags and en_US.UTF-8 collation. Before seeding the runner verifies these and
that the native gateway reaches the same owned database as fixture SQL. The
membership defect reproduced before the separate correction; applying and
replaying it preserved owner, ACL, security-definer flag and configuration.
The complete baseline had zero reconciled differences in 21 catalog categories
before the reviewed migration sequence. These are local signed-PostgREST and
provider-mocked results; GoTrue-issued sessions and hosted UAT are distinct gates.
