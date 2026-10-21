# Authoritative local CRM worker acceptance

This optional suite requires the complete, recovered October 19 schema restored
in the owned network-disabled PostgreSQL 17 container. Apply the original nine
reviewed security migrations in their documented cross-repository order first.
The fixture inserts only generated identities and synthetic `example.invalid`
records through the recovered tables, constraints and triggers. It does not
replace database functions, disable triggers or relax grants.

The suite is disabled by default. It has no database URL input: its adapter uses
only `/workspace/schema-runtime/exact-socket` (the source-role-faithful cluster),
port 5432, database/user `postgres` and
checks `valorwell.acceptance_disposable=true` inside every transaction. The psql
executable is restricted to the installed `/workspace/tools/pg/` tree. Do not
change these guards to run against hosted systems.

Reproduce the original membership-column defect after the original nine:

```sh
VALORWELL_RUN_AUTHORITY_DB=true VALORWELL_EXPECT_MEMBERSHIP_FAILURE=true \
  node --test scripts/worker-integration/crm-db.test.mjs
```

Apply the separate follow-on migration
`20261019165842_crm_campaign_membership_profile_contract.sql` only in that
disposable environment, then run:

```sh
VALORWELL_RUN_AUTHORITY_DB=true node --test scripts/worker-integration/crm-db.test.mjs
```

The correction must follow
`20261019000310_campaign_lifecycle_authorization_and_idempotency.sql`. It checks
that migration's operator authorization is present, fixes only the membership
column, preserves the function's current definition and ACL, and rejects unknown
predicate drift. This is a separate production rollout review item; it is not
part of the original nine. It has no dependency on Billing Hub's separate
`20261019085103_claim_status_authorization_boundary.sql` correction.

`load-edge.mjs` executes the actual source and denies unmocked provider egress.
`postgrest-client.mjs` uses the installed Supabase SDK, locally signed JWTs and
HTTP through the owned Unix socket to a network-disabled PostgREST container.
Application queries, embedded foreign-key selections and RPCs therefore execute
through the actual gateway against the restored PostgreSQL catalog. The private
local signing key is generated outside this repository; no hosted credential is
accepted. The PostgREST socket and signing file must exist in
`/workspace/schema-runtime/http` before enabling this suite.

`postgres-client.mjs` is restricted to fixture setup and inspection. Its direct
SQL adapter never stands in for an application call. Fixtures and assertions
check the disposable GUC on every transaction. No database functions, triggers,
constraints, grants or policies are replaced or disabled by this suite.

Coverage includes signed admin/operator enrollment and idempotency, readonly,
foreign-tenant and client denial, event eligibility and duplicate suppression,
actual trigger worker concurrency and lease ownership, scheduler delivery and
audit associations, suppression, cancellation, send windows, provider rejection,
and actual Social Media HTTP authorization and internal publication queue grants.
Social transports fail closed; the suite only queues synthetic publications.
Email providers return in-process synthetic responses, never real deliveries.
The relationship worker also executes against real lease and delivery RPCs: a
503 schedules retry, retry preserves provider idempotency, the next step waits
for its actual due time, a follow-up resolves the prior RFC Message-ID, and all
communication, contact, audit and enrollment state is inspected in PostgreSQL.
Inbound reply coverage uses the actual Resend 6.18 SDK signature verifier,
rejects invalid signatures before provider access, correlates the outbound
message, stops active enrollment, and deduplicates a replay.

This proves local gateway signature checks and database-backed application paths.
It does not verify hosted signed-in sessions, provider delivery, or GoTrue account
issuance. The existing offline worker regressions are also retained.

`VALORWELL_DB_SOCKET=/workspace/schema-runtime/socket` selects the earlier
bootstrap-superuser exploratory cluster for reproduction only; its results do
not establish source-role parity and are superseded by the exact-socket run.

## Final exact-cluster verification

The definitive run completed **15/15 tests (14 scenario groups), zero skipped**
after the original nine and the separately tested Billing claim correction.
The separate CRM membership correction reproduced its undefined-column defect
before applying, then passed; replay did not change its definition or security
metadata. Function owner, execution ACL, security-definer flag and pinned
configuration remained unchanged.

The final database uses source-role-faithful `postgres NOSUPERUSER` and
`en_US.UTF-8` collation. The runner verifies those properties before seeding and
confirms the SQL fixture and native gateway see the same generated tenant.
The restored baseline reconciled with zero differences across 21 normalized
catalog categories before migrations, including ownership, grants/grantors,
roles, RLS, dependencies and database metadata. The former exploratory cluster
is not used as definitive acceptance evidence.

Social denials now assert readonly/client HTTP 403, unsigned HTTP 401, identical
foreign/missing publication errors, and no queued publication or state change.
The successful operator path creates one local publication job; no publisher or
real media transport runs.
