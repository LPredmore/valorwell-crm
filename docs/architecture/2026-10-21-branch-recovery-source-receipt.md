# Branch recovery: sanitized operator receipt

Reported October 21, 2026, 02:02 UTC. **Operator-reported evidence, not independently observed by this source follow-up. No production release.**

Machine-readable metadata: [branch receipt](migration-recovery-evidence/20261021-branch-recovery-receipt.json).
Earlier October 19–21 receipts and manifests remain historical evidence; this receipt supplements rather than rewrites their execution status.

## Reported execution

- Operator authorized branch `valorwell-security-recovery-20261020`, ref `dskqovrvogmwrlmxsdjd`, UUID `cbf4bf6f-b2c9-4cd5-96cd-899fee2acc46`, parent `ahqauomkgflopxgnlndd`; creation rate **$0.01344/hour**. Current existence, billing duration and total cost were not checked here.
- Native historical replay failed at `20251201181524`: missing `public.set_updated_at()`, **0 migrations / 0 application tables**.
- Installed pg_cron **1.6.4**; imported the privately held schema-only export through **12 ordered branch-only reconstruction batches**. Original SHA256 `4da55b28809507eaa9438a0cb27a7f4335a884ea92dea87551890c0e6ef8230f`, **5,442,397 bytes**. Raw SQL was not shared with GitHub or Lovable and remains operator-only.
- Restored **425 base tables, 1,122 functions, 37 views, 551 policies, 368 noninternal triggers, 67 enum types**. No tenants, clients, claims or auth.users data imported.
- Applied post-snapshot `20261020214527`, then the ten reviewed security/claims sources, **in this order**:

```text
CRM       20261019000200
Billing   20261019000300
CRM       20261019000310
CRM #193  20261019165842  (immediately after 00310, not timestamp-sorted)
CRM       20261019000400
CRM       20261019000410
CRM       20261019000500
CRM       20261019000600
CRM       20261019000800
Billing   20261019085103
```

Stripe checkout service-only SQL is **not counted or reapplied**: already applied in production as `20261019232604`. Unrelated Stedi retirement was **not applied**.

## Reported checks and unresolved drift

| Check | Reported result |
| --- | --- |
| Column definitions | 6,188 MD5 matches by schema |
| RLS policies / indexes / table constraints | 551 / 1,578 / 2,399 matches |
| Base table, view and RLS schema counts | Match |
| Targeted SECURITY DEFINER RPC ACLs | anon blocked 15/15; service_role execute 15/15; authenticated blocked 14/15 |
| Intended authenticated exception | Read-only `claim_is_externally_submitted_v1` |
| Enrollment membership / operator guard | `tenant_memberships.profile_id`, authorized-operator guard retained |
| Claim submission status protection | Three triggers attached and enabled |
| SET ROLE anon runtime | `get_billing_identity_context` NULL; `get_crm_operating_context` crm_none, no capabilities |
| Authenticated campaign without membership | SQLSTATE 42501, unauthorized |

**Drift remains explicit:**

1. Precisely **12 supabase_admin managed default ACL statements** omitted from the last batch because of postgres role membership. This is not full grant/default-ACL parity.
2. `public.relationship_report_metrics_v` has a `pg_get_viewdef` fingerprint difference; type/invoker match. Canonical aliasing is only a hypothesis, **not a resolved review**.
3. Branch pg_net **0.20.4 / extensions**, production **0.19.5 / public**. Version/schema parity is not proven.
4. Branch ledger has **24 reconstruction/test versions**, not production's **966 historic versions**. No historic ledger entries fabricated. Control-plane remains **MIGRATIONS_FAILED**: **do not rebase, reset or merge this branch**.

The operator supplied aggregate results for 15 RPCs, not their complete signatures or per-RPC evidence. The existing 14-signature source ACL query remains unchanged; do not invent a fifteenth signature or equate the two sets. Advisor findings (**15 anon-executable / 306 authenticated-executable SECURITY DEFINER functions**) concern the wider function population, not necessarily these targeted RPCs; further review is required, not a newly proven breach.

## What source checks establish

The offline validator checks a closed sanitized metadata contract, exact reported values, release ordering and preserved limitations. It rejects unknown fields, duplicate JSON keys, wrong boolean types and altered attestations without echoing input diagnostics. It never reads credentials or connects to Supabase. Passing means **receipt consistency only**, not authenticity, live verification or release authorization.

```bash
python3 scripts/migration-recovery/branch_receipt.py
python3 -m unittest discover -s scripts/migration-recovery -p 'test_*.py' -v
```

Source CI includes these checks with no secrets, private SQL or branch access. Only the existing CRM source inventory is uploaded; neither private inputs nor raw query results become CI artifacts. The private local runner's strict managed-dependency/parity gates remain unchanged: this drift-bearing remote receipt cannot bypass them.

## Acceptance still missing

- Independent genuine **signed-JWT PostgREST own/foreign/missing-tenant tests** on the complete isolated stack; SET ROLE SQL is not equivalent.
- Real Stripe, Claim.MD and deployed Edge/worker workflow acceptance. No provider acceptance is fabricated.
- Review/resolution of default ACL, view and pg_net drift; broader advisor findings.
- Native 966-step replay recovery, production deployment, and separately authorized production release.

No live acceptance connector is added in this phase: exact 15 signatures, approved synthetic tenant/session fixtures and independent suite sources were not supplied. Any future user-operated connector must fail closed to the exact authorized branch, deny production identity, use secrets only outside source/arguments/artifacts, and avoid persisting tokens, SQL or PHI. No live automation runs in CI.

## Source follow-up boundary

Only recovery documentation, sanitized JSON, offline Python validation/tests, source CI, architecture rules and roadmap are changed. No Supabase calls, migrations applied, new paid resources, production writes, provider calls, workers or UI changes. Original #198 smoke and #199 boundary safeguards are preserved. Source PR/hosted CI/merge evidence must be reported separately; local tests cannot substitute for them. **No merge until required hosted checks are green; no production authorization follows from a source merge.**

## Verification actually run in this follow-up

| Source check | Result |
| --- | --- |
| Python recovery suite | **80 tests PASS**: 50 preserved + 30 new receipt regressions |
| Offline receipt CLI | PASS; operator-reported consistency only |
| Capture and preserved #198 smoke shell syntax | PASS; Docker smoke not executed |
| Private restore and isolated replay CLI help | PASS; restore not executed |
| CRM-only source inventory | PASS; no database acceptance implied |
| Real Billing Hub repository boundary gate | PASS; #199 fixture requiring stateful git was not run |
| Preserved #198 smoke / #199 boundary source | No diff to workflow, smoke script, boundary fixture or boundary gate |
| Source whitespace | `git diff --check` PASS |
| Latest preview diagnostic | `build OK` at 2026-10-21T02:04:30Z |
| Hosted CI / reviewable PR | **Unavailable**: no repository write/PR tool available; no commit, push, merge or hosted-green result claimed |
| Branch / signed-JWT / provider checks | **Not run here**, per source-only scope |

The source-gates workflow now triggers on this receipt and its JSON, and validates the receipt offline. Full application CI remains for hosted review; no manual application build/typecheck was run. The reviewable diff is ready for the existing repository integration, but an actual source PR and green hosted checks remain outstanding.