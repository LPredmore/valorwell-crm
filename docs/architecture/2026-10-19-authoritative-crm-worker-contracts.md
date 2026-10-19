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
