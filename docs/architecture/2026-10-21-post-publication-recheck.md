# Post-publication recheck — October 21, 2026

**The CRM publication did not invalidate the earlier database findings.** The served
CRM page identifies exactly the source commit used in the original checks. Fresh
production and test catalogs contain zero added, removed or changed object fingerprints
relative to the previous final captures. A separate deployed Billing Stripe code gap
was identified and reproduced locally without invoking production integrations.

[Sanitized follow-up evidence](migration-recovery-evidence/20261021-post-publication-recheck.json)
records the new observations and binds the prior receipt and catalog query bytes.
Earlier receipts remain unchanged. No database mutations, migration applications,
deployment, provider calls or signed-in production browser actions occurred in this
recheck. Production remained read-only.

## Publication and source identity

- Fresh Git fetches leave CRM main at `4d3e9f34aee0d81c5657033f022662370fd4ae49`
  and Billing main at `050625035fbc43dc3a48bc53653b685e14b7142b`, exactly the original
  source revisions. There are no new main-branch source changes to retest.
- Lovable reports project `67d68fb5-d6d7-40fb-b409-203945e02edd` as published, with
  latest commit `4d3e9f34...`. Its last-edited timestamp is 10:41:33 UTC; this is not
  a publish-completion timestamp, which the tool does not expose.
- A static GET of `https://crm.valorwell.org/` returns HTTP200. The page's hosting
  `data-commit-sha` is the same complete `4d3e9f34...` commit, and its artifact ID is
  recorded in evidence. The historical lovable.app address redirects to that custom
  domain. No browser JavaScript was executed or authenticated data requested.
- The served application entrypoint is `/assets/index-A58DD57H.js`, SHA-256
  `5a45d3c563bfd51ceb65535131d9d53b4f770ce0806abc1500d21843304517d1`.
  It references production Supabase `ahqauomkgflopxgnlndd`, not the recovered test
  project. Publishing CRM did not repoint it to the recovery branch.
- A fresh build of the exact published main revision passes using the existing pinned
  dependencies. The local asset bytes differ from the hosted asset; build environment
  and hosting transformations were not independently reconstructed. Source identity
  above is established by matching Git/Lovable/served hosting metadata, not a claim
  of byte-reproducible hosting.

The earlier report did not claim signed-in hosted UI acceptance. Its blocked UI/Auth
tests therefore cannot be upgraded merely because publication completed. Unmerged
CRM #193 and #200 changes also remain separate from the published main revision.

## Fresh database verification

| Check | Production | Authorized test branch |
| --- | --- | --- |
| Catalog objects compared | 13,416 | 13,394 |
| Changes since previous final snapshot | 0 added / 0 missing / 0 changed | 0 added / 0 missing / 0 changed |
| Migration ledger | 966, latest 20261020214527 | 28, latest 20261021111438 |
| Targeted RPC ACL checks rerun | 4 PASS / 12 FAIL | 16 PASS / 0 FAIL |
| Storage policies | 19 | 0 |
| Database engine | PostgreSQL 17.6 / aarch64 | PostgreSQL 17.11 / x86_64 |
| pg_net | 0.19.5 / public | 0.20.4 / extensions |
| Cron | 52 jobs, 42 active | 0 jobs |

The comparisons use each object's identity and definition/permission fingerprint,
not just counts. Fresh server-side catalog digests are recorded for subsequent
rechecks; MD5 is a comparison aid, not source authentication. Separate READ ONLY
snapshots were used, so this is not a cross-database atomic snapshot.

The test-branch ACL, Auth-hook and application-publication repairs remain installed.
The 19 missing Storage policies, managed realtime publication/memberships, extension
and engine differences remain. The branch control plane still reports
`MIGRATIONS_FAILED`; neither publication nor this recheck establishes historical replay.

## Deployed code versus current source

Read-only Supabase source inspection compared these production Edge bundles to their
respective current-main files. No HTTP request invoked any of these handlers.

| Function | Result |
| --- | --- |
| campaign-trigger-worker v128 | Entrypoint exactly matches CRM main |
| campaign-scheduler v195 | Entrypoint and all four returned dependencies exactly match CRM main |
| relationship-campaign-worker v147 | Entrypoint and returned email helper exactly match CRM main |
| submit-claims v136 | Entrypoint and returned auth/CORS helpers exactly match Billing main |
| fetch-remittances v152 | Entrypoint exactly matches; helper differences are trailing whitespace and lint comments; comment-free emitted JavaScript matches |
| stripe-webhook v73 | Entrypoint differs functionally from Billing main; account helper differs only in trailing whitespace |

Both production and branch function listings returned inherited/same function IDs.
Those listings are not proof that the recovery branch has an independently deployed,
isolated Edge runtime. Source comparisons above explicitly used the production selector.

### Stripe deployment gap

The deployed Stripe entrypoint has SHA-256
`7ba1adeeb9e2b6b8669befd46ecca2d7944131092d8466e39373a8f6bbfb59c8`;
current Billing main has
`b76793099c58ffc32a8b4d806633010d84808f2e983d5ea4467556acb313235b`.
Its deployed code lacks the newer currency guards and delayed Checkout outcome handling
already merged through Billing #38 and #44. CRM frontend publication does not establish
deployment of that Billing function.

The unchanged existing Stripe worker suite was run against a **private copy** of the
retrieved deployed entrypoint and helper, then against unchanged Billing main:

| Input | Executed result |
| --- | --- |
| Deployed v73 source copy | 15 PASS / 5 FAIL, exit 1 |
| Billing main source | 20 PASS / 0 FAIL, exit 0 |

The five failures concern missing currency, currency mismatch, delayed payment success,
delayed payment failure audit and retry after failed async audit persistence. This is
an execution-backed source/deployment difference, not evidence that a particular real
payment was lost or misposted.

Both runs use actual Stripe SDK signature verification with synthetic signatures and
the unchanged deny-egress VM loader. Database and provider adapters are fake; no real
webhook was replayed, financial RPC invoked, provider queried or payment initiated.
These results do not replace native PostgREST/database or sandbox acceptance. No new
accepted-claim response was created or used.

The minimal source correction and regression tests already exist on Billing main.
Retain the exact reviewed entrypoint/helper hashes in a release bundle, finish the
outstanding database/sandbox acceptance, then seek separate approval to deploy the
Billing webhook. Do not redeploy production or replay historical events automatically.

## Readiness after recheck

The prior production-readiness assessment remains **NOT READY**, now with an explicit
Stripe deployment gap. Valid independent user/tenant PostgREST testing, complete owned
isolated infrastructure and genuine provider-sandbox evidence remain blocked by the
same missing prerequisites; publishing a frontend does not provide them. Existing PR
#200/#50 CI was verified green before this documentation follow-up. No broad rerun of
unchanged source suites was needed; database authorization checks and deployment-sensitive
Stripe behavior were rerun, and the published main revision was rebuilt.
