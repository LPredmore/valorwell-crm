# October 19 worker orchestration acceptance

The maintained suite executes the checked-in Edge Function source rather than testing
source-text patterns or substituting worker implementations. `edge-worker-runtime.ts`
transpiles modules into isolated VM contexts, captures `Deno.serve`, supplies only
synthetic environment values, and denies all network access unless a test supplies
an in-process transport. Each module has a shared Error constructor, matching a
single Edge isolate's error semantics.

Run:

```sh
npx vitest run src/test/campaign-worker-runtime.test.ts src/test/campaign-scheduler-runtime.test.ts src/test/social-edge-runtime.test.ts
```

Coverage added:

- Campaign trigger handler: service/cron authorization, browser denial, bounded
  batch claims, returned claim-token propagation, failed-job continuation, claim errors.
- Relationship worker: authorization/token verification, preparation, outbound
  payload and association, stable provider idempotency, Message-ID resolution,
  threaded follow-ups, missing-root refusal, permanent and transient provider
  failures, retry scheduling/exhaustion, uncertain transport outcomes, preparation
  refusal, and recording errors.
- Client campaign scheduler: actual personalization and suppression evaluator,
  canceled/inactive work, policy failure and foreign-client refusal, send windows,
  sent-message associations, owned-lease finalization, audit events, next-step
  scheduling, completion, provider rejection, and lost-lease handling.
- Social Media HTTP entrypoint: actual operating-context authentication, mutation
  capability enforcement, tenant-scoped publication loading before privileged
  queue RPC, admin/operator success, readonly/foreign/anonymous refusal, replay,
  and browser denial of internal cron dispatch. No publication worker runs.

## Evidence boundary and remaining acceptance

These are worker orchestration regressions with synthetic database adapters.
They do not establish compatibility with the complete production schema. RPC
results, embedded campaign relationships, lease exclusion, and Social Media
triggers use explicit synthetic contracts. They do not verify JWT signatures,
RLS enforcement, authoritative constraints, real transactional concurrency,
provider delivery, or hosted signed-in access. The concurrent scheduler test
checks handler behavior when one mocked claim is returned; it does not prove
PostgreSQL locking behavior.

Full acceptance still requires linking the actual application enrollment and rule
entrypoints and these worker paths to the recovered authoritative database and
signed local identities. That run must verify real eligibility, trigger creation,
queue ownership, cancellation races, duplicate suppression, inbound reply
correlation, audits, and tenant denials. Existing SQL acceptance remains useful
but cannot replace that run. No real email, financial transaction, media upload,
production database write, or Edge Function deployment is part of this suite.
