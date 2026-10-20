# Isolated campaign lifecycle acceptance

`run-campaign-lifecycle-acceptance.py` extends the reviewed Billing Hub 5B/5C
runner with actual campaign SQL and signed GoTrue/PostgREST security regressions.
Corrected acceptance requires `--membership-correction /private/path/20261019165842_crm_campaign_membership_profile_contract.sql`
from unchanged CRM draft PR #193. The runner verifies its SHA-256, applies it immediately
after 00310 only in the isolated fixture, and never invents a `tenant_memberships.user_id`
column. `--baseline` intentionally omits both corrections to reproduce failures.
It requires local PostgreSQL tools, Docker, Node, and reviewed Billing Hub and
Clients checkouts supplied with `--billing-repo` and `--clients-repo`.

The runner creates its own loopback cluster. Every SQL mutation uses the existing
active-connection guard (system identifier, data directory, cluster, port and
database) and `ON_ERROR_STOP`. It never accepts a database URL or production
credential. It runs the unchanged original 5B fixture, including its session
setting and ending rollback, plus all original 5C assertions.

Additional cases cover all six campaign mutation RPCs, readonly and foreign
callers, independent actor/tenant/target/operation key scope, unfinished claims,
same-key and different-key concurrent PostgreSQL sessions, exact successful
replay, all five transitions, and empty-batch manual enrollment compatibility.
Real GoTrue-issued tokens exercise browser denials for all six public RPCs and
the internal helpers. Stripe ACL checks use the exact Clients function and
Billing Hub corrective migration; the service control uses a missing session,
so no payment or allocation is posted.

`--baseline` skips only the new corrective migration and keeps every expected
assertion unchanged, reproducing the original failures. `--output-dir` selects
the evidence directory. Clusters and containers are stopped on completion.
Synthetic dependency tables are reviewed minimal contracts, not a reconstruction
of the complete production schema. This suite does not prove full application
browser workflows, live deployment, or external payment webhook behavior.


Current-main compatibility also covers fail-closed retired-donor reporting and
replay refusal, including overlapping synthetic provider identities under two
real signed tenant JWTs. New migration versions are checked across all three
shared-database checkouts before initialization; `--check-migration-sequence-only`
performs that read-only check without creating a database.

## October 18 emitter regression extension (post-PR #181)

The current runner adds **two additional scenario groups** to the previously reported 78 (the old Codex record remains 78/78 and must not be rewritten as a new execution result). The fixture in `supabase/tests/crm_emitter_exact_body_isolated_fixture.sql` embeds the exact `crm_emit_automation_event` function body inspected from the live read-only catalog on 2026-10-18, with only synthetic dependency tables/functions. The runner uses genuine GoTrue-signed anonymous/tenant-user tokens to assert direct PostgREST denial after applying unchanged migration `20261019000600`, then verifies positive trusted service JWT execution, duplicate-key idempotency and one synthetic downstream job. No real message transport, real campaign rule engine, donor job, payment, clinical row or social publishing occurs.

**Limit:** The downstream `crm_enqueue_campaign_trigger_jobs` and `private.crm_resolve_person` dependencies are minimal isolated stubs. This explicitly does *not* prove that a real trigger condition, active campaign, or worker queue runs correctly, nor does it cover full schema replay. The full actual worker/trigger/authorized browser acceptance remains a release blocker. The extra groups are not independently executed merely by source CI; capture fresh `additional-jwt-outcomes.json` / runner results and actual clean exit before upgrading the count from 78 to 80.

## Optional worker-body supplement

Pass `--extended-workers` to add seven scenario groups to the unchanged 80-group
suite. The supplement extracts the exact checked-in Social Media queue, campaign
trigger-enqueue, concurrency evaluator and email-reply correlation bodies. It
checks anonymous and real signed browser denials, trusted service execution,
queue uniqueness, correlation and step cancellation, plus all five lifecycle
transitions and replay under genuine GoTrue operator/admin identities.

A separate disposable GoTrue instance also issues a genuine anonymous-user JWT
(`is_anonymous=true`, PostgreSQL role `authenticated`), distinct from the local
signer's `anon` role token. Its database system identifier is checked through the
container route before startup. Email signup is disabled and SMTP is loopback
port 9. No provider transport or publishing dispatcher is installed.

Dependency tables are explicitly minimal contracts. The trigger feature-flag
helper is a synthetic true control; identity resolution remains the earlier
synthetic stub. These tests prove real function-body and JWT behavior, **not** a
full-schema deployment, actual rule-engine processing, outbound sending, Stripe
posting, claims/Stedi finalization or payroll integration. Missing authoritative
base-schema and worker bodies remain release blockers.

Forward migration `20261019000800_campaign_lifecycle_forbidden_response.sql`
corrects the lifecycle helper's missing/foreign-target denial from SQLSTATE
`P0002` (PostgREST HTTP 500) to `42501` (HTTP 403). Both target cases keep the
same message and no existence disclosure. The eight earlier security migration
files remain unchanged and retain their order; this is a separate follow-on.
The signed foreign-target regression requires HTTP 403 before and after the
correction, failing on the previous implementation.

The Stripe ACL source is resolved by Billing’s `release_migration_sources.py`: only current version `20261019232604` with the reviewed SHA-256 is accepted. Its reviewed historical version `20261019000100` remains a provenance reference; the runner does not recreate or pretend to apply the old ledger version. Missing, ambiguous or altered source fails before fixture creation.
