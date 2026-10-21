# Production completion package — 2026-10-21

Source implementation and deployment are separate. This package does not authorize a production migration, Edge deployment/deletion, financial transaction or event replay. Lovable publication does not deploy this database or these Edge Functions. The user published the previous main; publish the newly merged frontend separately.

## Refreshed production evidence

Read-only inspection on October 21: production `ahqauomkgflopxgnlndd` has 966 migration entries, latest `20261020214527`. October 19 CRM authorization files and Billing `20261019000300` / `20261019085103` remain absent. Stripe ACL `20261019232604` is already recorded. Historical versions `20260924221039`, `20261007140519`, `20261009190819` are recorded: their PRs reconcile source and must not be replayed.

A targeted production ACL check still finds all 12 reviewed internal RPCs callable by authenticated users; the prepared revocations are not deployed.

Stedi now has zero enabled routes and zero active cron jobs whose name/command mentions Stedi. The no-reactivation constraint is absent. All twelve Stedi Edge endpoints remain listed ACTIVE, but freshly retrieved deployed source confirms every one is already an inert 410 tombstone with no imports, data bindings or provider transport. ACTIVE is deployment lifecycle status, not evidence that Stedi processing remains enabled. Their previously missing source tombstones are now reconciled into main; replacement deployment is unnecessary. This supersedes older evidence of two active routes/four jobs. No historical claim records were retrieved or modified for this package.

Stripe endpoint `we_1U0QK1K6NXPL7VzoDT0KzcRA`, canonical live account `acct_1OprKCK6NXPL7Vzo`, is enabled at the production `stripe-webhook` URL. Subscriptions remain `checkout.session.completed`, `checkout.session.expired`, `payment_intent.payment_failed`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`. Both `checkout.session.async_payment_succeeded` and `checkout.session.async_payment_failed` are missing. Deployed webhook remains v73; corrected source is already in Billing main via #44.

## Database release order

The repositories share one Supabase database and migration ledger. Apply these exact new files in this global order, using the normal authorized migration service, recording the actual applied version and SHA-256 of each payload:

1. CRM `20261021184712_production_crm_security_rollforward.sql`: reviewed October 19 least-privilege CRM helpers, lifecycle authorization/idempotency, authoritative `profile_id`, internal worker permissions, pinned trigger search path, legacy donor fail-closed attribution and indistinguishable 403 denials. Order is incorporated into one transaction.
2. Billing `20261021184713_production_stedi_retirement.sql`: disable matching cron jobs and Stedi routes; add a no-reactivation constraint. Retain route rows and financial evidence. Future-dated routes are disabled without inventing a historical end timestamp.
3. CRM `20261021184721_production_storage_tenant_boundary.sql`: replace broad write policies for `org-logos`, `training-covers`, `email-signatures`; public reads remain unchanged.
4. Billing `20261021184735_production_billing_security_and_payroll.sql`: service-only internal reconciliation, tenant-authorized claim-status wrapper plus unfiltered internal submitted-claim invariant, and hash-bound payroll denial correction.
The deployed Gmail resolver body already exactly matches merged #170 (SHA-256 `68f88f02c612fa916ef72ed9187982c0663df13f0e4cb095e54eb0d4d714c6f7`). Its historical source version is not in the ledger, but exact deployed-source parity establishes that no replacement migration is needed. Preserve history and do not replay it.

Do not run an unrestricted `db push --include-all` or historical replay: older source migrations precede the live ledger head. Do not use migration repair, rename historical versions, or insert ledger rows. Submit only each new payload through the authorized migration service. If that service assigns a new version, preserve the original source filename and actual execution receipt; do not fabricate an earlier execution. Recheck the live head/definitions immediately before deployment and stop if source guards report drift. No independent schema-owner approval is asserted by this document.

The CRM/Billing envelopes require reviewed baseline version `20261020214527`. Replaced existing security functions require the captured production definition fingerprints and postgres ownership. Storage requires the complete captured object-policy catalog fingerprint so an unreviewed permissive policy cannot silently override the new predicates. The already-deployed Gmail resolver has separately verified exact body parity. Unexpected drift requires a new read-only review and updated forward migration, not bypassing an assertion.

Payroll uses `pg_get_functiondef` inside the database and changes exactly one `STAFF_NOT_FOUND` branch from SQLSTATE `P0002` to `42501` (PostgREST 403 for authenticated callers). Preconditions: definition SHA-256 `94a270c6385aa7102c875ec6f6590bd343afc9bbb804419ecfe2ebd84838650e`; postimage `1da469903a9bcd8fea465ff98622b7e89078840ea4affa81115b3c109e617436`. Ownership and ACL must remain identical. Calculations, numeric arithmetic and legitimate staff access are unchanged. No private payroll body is committed.

## Storage rollout and existing assets

Publish the metadata-aware email-signature uploader before applying the Storage migration. Every other operator upload client for these three buckets must supply `metadata: { tenant_id: <selected tenant> }`. The checked-in CRM has no other uploader for these buckets. Metadata alone never authorizes a write: it must match trusted JWT `app_metadata.current_tenant_id`, actual membership and CRM admin/operator capability. UPDATE checks both the old row and new row, preventing metadata relabeling of a foreign object.

Existing untagged files keep their exact paths, references and public reads, and fail closed for writes. No tenant is inferred or backfilled. An authorized user can upload a newly tagged replacement at a new UUID path and update the owning record through its normal tenant-authorized application flow, retaining the original file. In-place updates/deletion require an operator's independently verified object-to-tenant mapping from authoritative owning records; ambiguous/shared files remain read-only. Keep that mapping/evidence private. The old capability-only verification SQL is superseded and must not be applied.

Before release, obtain normal schema-owner review and a restricted recovery export of affected definitions, ACLs and policies. Apply each transaction separately; failures roll back that transaction. Recovery after commit uses a newly reviewed forward correction from that restricted export. Never restore broad public RPC grants or broad Storage writes to recover functionality. If a frontend rollback is needed, retain restrictive policies and use the replacement-file workflow.

## Edge release

From Billing main deploy `stripe-webhook`, retaining the existing account selection and privately configured signing secret. Use the project's established webhook deployment configuration (gateway JWT verification disabled, handler validates raw-body Stripe signature). Do not rotate or print existing secrets. After deploying the corrected handler, add the two asynchronous Checkout subscriptions to the existing endpoint while preserving all six current events and endpoint identity. Do not create a duplicate endpoint. This is an external production configuration step requiring separate authorization.

Fresh deployed-source comparison confirms the shared Google sync module matches current main in `relationship-gmail-push` v142, `relationship-google-maintenance` v145 and `relationship-calendar-webhook` v138. The `relationship-campaign-worker` v149 entrypoint also matches main, including trusted work-item tenant scoping. These four CRM functions do not need another deployment for the fixes in this package. Existing campaign scheduler, trigger and social handlers must retain their authenticated/cron-secret entry guards and service-role internal RPC calls; no new provider credentials are required for these source changes.

The following twelve Stedi endpoints already run data-free 410 tombstones, now preserved in Billing main. Keep them inert; optional later deletion requires separate approval and reference review:

- `stedi-connection-test`
- `stedi-build-claim`
- `stedi-claims-access-test`
- `stedi-claim-create-access-test`
- `stedi-payer-check`
- `stedi-eligibility-check`
- `stedi-validate-pilot`
- `stedi-submit-claim`
- `reconcile-stedi-uncertain`
- `stedi-lifecycle-sync-v2`
- `stedi-uncertain-reconcile-v2`
- `check-stedi-realtime-claim-status`

Use `supabase functions deploy <slug> --project-ref ahqauomkgflopxgnlndd` from the correct repository after authorization; honor committed config and check the deployment receipt. Do not bulk deploy every function. The tombstones require no secrets, data access or provider transport. Only `stripe-webhook` currently requires an Edge replacement for this release. Keep historical Stedi database functions/types where needed to preserve evidence and legacy schema contracts. Do not delete claims, attempts, acknowledgments, response payloads, events or financial history. Do not turn uncertain Stedi attempts into Claim.MD retries; reconcile privately against real provider evidence first. Claim.MD active paths remain intact.

## Post-deployment checks and weekly operation

Read-only: capture actual migration receipts and ledger head, function fingerprints/owners/ACLs, policy catalog, zero enabled Stedi routes/jobs, no-reactivation constraint, Edge versions, Stripe endpoint's eight subscriptions and deployment logs. Verify ordinary signed-in operations over time through the existing Todoist Inbox checklist; keep production checks open until observed. Minimal authorized smoke checks must not send messages, claims or payments merely to produce a green result.

For Stripe reconciliation, use the established private read-only provider/database review to compare Checkout Session IDs, actual paid status, currency/amount, target invoices or appointments, one resulting posting and audit persistence. Inspect async failures and retriable persistence errors. Source tests include unpaid sessions, missing/mismatched currency, duplicates and audit failure retries. A test double proves handler behavior, never provider acceptance. Do not automatically replay uncertain financial events.

Use existing Wednesday review `Weekly — review ValorWell CRM/Billing production checklist and new errors`. No additional testing project or sandbox is required. Necessary remaining actions are authorized production deployment/configuration, review of any newly detected drift, publication of the updated frontend, and observation of real operations. No provider credentials need to be pasted into chat.

## Source PR disposition

CRM #193, #170 and #114 and Billing #49 and #14 are merged. CRM #97's already-deployed activity fix is retained as source in the completion PR. Selective implementation from #203 includes tenant-bound Storage metadata/policies; its private payroll preparation is replaced by the body-free migration above. #200's preview timeout regression is retained; current main already has the safer timeout implementation. CRM #200/#202/#203 and Billing #34/#50 are superseded by the completion package; no new native/reconstruction stack is adopted. CRM #100's historical audit is superseded by the current security release assessment. Unrelated CRM #84 thumbnails and #67 newsletter redesign remain separate feature proposals and are not prerequisites to this CRM/Billing security release; their broad changes must not overwrite newer production functionality.

Exact payload checksums and global ordering: [production-completion-manifest.json](production-completion-manifest.json). Empty execution receipts mean no production deployment has occurred.

After release run `supabase/tests/production_completion_readonly.sql` with an authorized read-only SQL client. It reports catalog gates without returning clinical or financial records. Expected counters and booleans are documented inline; runtime/provider verification remains separate.
