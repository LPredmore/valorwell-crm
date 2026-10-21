# Implementation/retest execution — October 21, 2026

**NOT READY. P0 source preflight implemented; P1–P5 native acceptance BLOCKED.**
This is a partial execution receipt, not completion of the implementation plan.
No production writes, deployments, provider calls, email, cron activation, branch
reset/rebase/merge or diagnostic-preview deletion occurred.

## Inputs and fresh observations

[Pinned references and read-only observations](migration-recovery-evidence/20261021-retest-inputs.json)
record both main SHAs and exact heads for CRM #193/#197/#198/#200 and Billing
#34/#40/#44/#50. CRM main is `63052bdf6424bad437e268eb031b9300c8d6a894`;
Billing main is `050625035fbc43dc3a48bc53653b685e14b7142b`.
CRM #193/#200 and Billing #34/#50 remain open. #193's source CI was green;
this does not satisfy its database/GoTrue acceptance gate or authorize merging
without review. Existing implementation is preserved rather than duplicated.

Supabase control-plane reads independently identified production Billing Hub
`ahqauomkgflopxgnlndd`, PostgreSQL release `17.6.1.052`, and diagnostic preview
`dskqovrvogmwrlmxsdjd`, still `MIGRATIONS_FAILED`. Explicit READ ONLY catalog
transactions confirmed 966 ledger versions ending `20261020214527`, ordered
version-list MD5 `7a263d51891681b67ae85dffc2db5006`, and 19 Storage policies.
Stripe webhook remains v73, bundle SHA-256
`00d86c815fc1cb138fcc61185423588e34fdf65f8a1b6d7a3182d40b6e34bdaf`.
The partial relation/function fingerprint is deliberately labeled partial;
it is not a complete-schema comparison or authorization result.

No private baseline artifact, named review receipt or native acceptance stack was
provided in this workspace. Environment readiness reported no configured private
secrets. Docker is available; availability alone supplies neither an approved
baseline nor server-side isolation evidence. The existing private-bundle preflight
returns BLOCKED before execution. Baseline checksum and acceptance schema
fingerprint remain null rather than copying an old artifact hash as current proof.

## Reproducible offline preflight

From CRM, with detached checkouts at the pinned dependency heads:

```sh
python3 scripts/migration-recovery/retest_preflight.py \
  --repo crm=. --repo billing=/trusted/billing \
  --repo crm-draft193=/trusted/crm-draft193 \
  --repo billing-draft34=/trusted/billing-draft34 \
  --output /private/new-retest-preflight.json
```

The command hashes all eleven actual SQL files in reviewed order, retaining the
membership correction immediately after lifecycle 00310. It records checkout SHAs
and dirty flags, dependencies, assertion counts, environment selectors, evidence
URIs and owner actions for all eleven named gates. Missing/drifting required SQL
stops before any acceptance work. The output is created exclusively; existing
receipts cannot be overwritten. It always exits **2/BLOCKED**: no database or
provider acceptance runs, and inventory alone cannot promote a gate to PASS.
This is the P0 entrypoint, **not the completed P5 stack orchestration**.

Run offline recovery checks with:

```sh
python3 -m unittest discover -s scripts/migration-recovery -p 'test_*.py'
```

Existing source CI discovers the new safety tests and checks CLI help. It needs
no private schema. No new private-runner CI job is advertised as functional before
its artifact and runtime requirements have been supplied and tested.

## Remaining owner actions

The generated gate manifest preserves the plan's DB-01/02/03/04, SEC-01, CRM-01,
INT-01, BILL-01/02 and STEDI-01 blockers with owner actions. In addition, CRM #201
tracks a newer potential cross-tenant Storage write boundary. Exact policy parity
must not be misreported as proof that those policies enforce tenant boundaries.
Preserve #200's original 970-pass/one-timeout result and later focused/CI results
as historical evidence; new results do not rewrite them.

1. Schema owner: provide the approved complete immutable private baseline bundle,
   named secret/dependency/ACL review, export-time ledger and fresh inventory.
   Do not upload raw SQL or capabilities to GitHub.
2. Platform/test owner: provision a fresh owned native Auth/Storage/PostgREST and
   realtime stack with proven server-side egress denial, exact catalog comparisons
   and synthetic GoTrue identities. Reconcile managed ownership and extension
   differences without broad managed-role grants.
3. CRM/Billing owners: execute database-backed workers, signed roles, Stripe
   financial posting/reconciliation, claims/payroll immutability and synthetic
   Stedi history fixtures on that verified stack. Existing locally signed JWT
   adapters do not by themselves prove GoTrue-issued identity acceptance.
4. Sandbox/UAT owners: supply designated isolated provider/Stripe sandboxes and
   hosted UI acceptance evidence. Never count fixture acknowledgement as provider
   acceptance. Review uncertain Stedi routes separately before retirement.
5. Test owner: implement and verify the remaining P5 provision/seed/suite/cleanup
   orchestration, then reproduce it from a second clean workspace. This preflight
   does not meet that exit criterion.

## Proposed production envelope — blocked, no executable deployment

The generated manifest contains the eleven ordered reviewed inputs and SHA-256s.
Stedi is optional and separately owner-gated; the ten security inputs retain their
exact cross-repository order. Final deployment versions are null. Immediately
before any future packaging, refresh the live ledger and use CLI-generated new
versions strictly above its actual maximum. Never replay applied Stripe
`20261019232604`, applicant `20261020214527`, or old alias `20261019000100`.
Preserve supersession mapping, preimages, backups and recovery review in P6.
SQL, workers, Stripe Edge, Stedi retirement and cron activation each need their
separate release authorization. No production rollout or preview merge is approved.
