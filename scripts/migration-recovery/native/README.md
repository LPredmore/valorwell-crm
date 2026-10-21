# Native development retest

This runner creates genuine Auth, Storage, PostgREST, Realtime and PostgreSQL
services on a label-owned Docker **internal** network. All credentials are newly
generated. SMTP points to a closed local port. Proxies are cleared, host routes
are prohibited, cron execution is disabled, and only loopback ports are published.
Workers run with injected synthetic provider transports; their database requests
reach actual native services. No external transactions are authorized or performed.

The current-state candidate is private, redacted, and **not owner approved**. A
successful restore does not establish complete production parity. No historical
application migration ledger is fabricated. Exit code 2 deliberately keeps the
full acceptance/release gate closed, including when development checks finish.

## Reproduction

Use Linux/amd64, Python 3.11+, Node 22+, Docker, crane 0.22.1 and sufficient disk
space (the vfs engine needs approximately 25 GB including image preparation).
Install Python psycopg for the existing Billing catalog reconciler. Preserve the
existing CRM #193/#200 and Billing source checkouts; use their frozen commits in
the completion report. Install each repository's locked npm dependencies and the
Billing `scripts/worker-integration` dependencies.

1. Install images with `python scripts/migration-recovery/prepare-native-images.py
   --cache /private/public-image-cache`. The two large images are flattened from
   immutable upstream digests; file-content checksums are verified before import.
   Imported Docker IDs differ from upstream layered manifest IDs by design.
2. Copy `native/sdk-runtime/package*.json` to an owner-only directory outside Git
   and run `npm ci --ignore-scripts` there. This pins Resend 6.18.0 for unchanged
   CRM webhook assertions; it does not send email.
3. Recover the private candidate, or prepare read-only catalog queries using
   `catalog_candidate.py --billing-repo /src/billing --prepare-queries
   /private/queries.json`. Execute them only through existing authorized read-only
   Supabase access; retain returned captures as `<category>.capture.json`, including
   the exact executed query SHA256. No app records, passwords or vault values are
   queried. Finalize with `--captures /private/captures --output /private/candidate`.
   Finalization verifies the query hashes and ledger boundary. Separate transactions
   are not an atomic global snapshot. Redaction changes executable semantics and
   requires review; source hashes preserve that distinction.
4. Run from a fresh checkout:

```sh
python scripts/migration-recovery/run-native-retest.py \
  --private-run /private/fresh-run \
  --candidate /private/candidate \
  --repo crm=/src/crm --repo billing=/src/billing \
  --repo crm-draft193=/src/crm-draft193 \
  --repo billing-draft34=/src/billing-draft34 \
  --resend-module /private/sdk/node_modules/resend/dist/index.mjs
```

The runner restores staged DDL, reconciles the genuine application publication,
compares 21 strict catalog categories, applies the ten ordered security deltas,
seeds synthetic tenants/personas, runs Storage isolation and unchanged CRM/Stripe
database suites, checks Stedi retention, and removes its owned containers/network.
Results and raw logs stay private under the run directory. Worker tests count
genuine native database behavior; provider responses remain simulations. The
initial foundation matrix tests generic probe RLS, not all application personas.

`--retain-for-diagnosis` retains only the labeled run. Use
`cleanup-native-retest.py --private-run /private/fresh-run` afterward. Cleanup
checks resource ownership and never removes unrelated containers. Earlier failed
attempts must remain in the evidence record.

## Independent schema-owner review

No independent approval exists. Review the private manifest, all 46 redacted rows,
function SECURITY DEFINER/search_path/ACL behavior, Auth signup hook, 19 Storage
policies, extension configuration, database settings, roles/default ACLs and the
full strict comparison. The captured ledger contains 966 versions with eight
bodyless versions; its history is provenance, not a reproducible historical replay.
Classify every remaining difference before claiming parity. In particular pg_net
0.19.5 has a native schema-location difference, and managed platform versions,
architecture, roles and migrations differ. Do not blanket-allowlist managed drift.

## Provider sandbox binding

No designated provider sandbox was configured in this workspace. The connected
Stripe accounts expose live mode only; they are excluded. Configure credentials
using the approved secret manager or managed environment secret bindings, never
chat, Git, shell arguments or reports. Keep these bindings outside the isolated
native run, whose network deliberately cannot contact providers.

* Claim.MD: `CLAIMMD_API_KEY`; the legacy remittance path separately reads
  `CLAIM.MD_API_KEY`. Bind only designated sandbox credentials with permissions for
  the specifically authorized synthetic submission/status/remittance operations.
  Current source uses fixed provider URLs: a secret alone does not establish a
  sandbox. Verify the provider's designated test-account routing first.
* Stripe: `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, plus only locally
  generated `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`. Use a designated test account,
  confirm `livemode=false`, and allow only account lookup/webhook test operations.
  Existing synthetic regression payloads may deliberately say `livemode=true` to
  exercise current production-source guards; they never contact Stripe.
* Payroll: `FLY_PROXY_URL` and `FLY_INTERNAL_AUTH_TOKEN` are read by recovered
  deployed v119, in addition to local Supabase bindings. Use a designated sandbox
  proxy with outbound transfer creation disabled until separately authorized. The
  source harness injects a synthetic Mercury transport. Obtain the provider's designated payroll/Mercury test account and its
  documented permissions/secret names before binding an executable sandbox adapter;
  no payroll adapter or production token is inferred from connected bank access.

External provider transactions remain outside this authorization. Once sandbox
bindings are available, obtain explicit authorization for the exact test operations
and preserve provider-returned evidence. Never synthesize accepted claims or
provider acknowledgments to close those gates.
