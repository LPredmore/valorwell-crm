# Infrastructure acceptance — October 21, 2026 (America/Chicago)

Baseline main: `70f50ab` (PR #210); PR #209 already contains the deployed reply-owner trigger and full-content Gmail ambiguity handling. No Pub/Sub configuration was repeated.

## Confirmed production evidence

- Gmail test message/thread `1a160ddee392291c`, subject Test, has no In-Reply-To/References. Message internal date 23:48:28 UTC, Gmail received approximately 23:48:40 UTC. Its current Gmail history ID is 3484481 (a mutable mailbox history marker, not proof of the original message-added event).
- Push logs: history 3484476 at 23:48:45.250 UTC and 3484487 at 23:49:40.631 UTC. Live matcher returns observationEnabled=true, likelyRelationship=true, ambiguous=true, matched=false.
- The message was NOT dropped: an open `ambiguous_email_thread` reconciliation issue was created at 23:48:45.086618 UTC, approximately 5 seconds after Gmail receipt and 17.087 seconds after internal date. No canonical communication was defensibly attributable. Do not force it into an unrelated opportunity. This proves review-queue latency, not canonical-message capture latency. Exact historical messageAdded membership is not available through the connected Gmail tool.
- Gmail sync cursor 3484487; last notification/success 23:49:40.615654 UTC; watch expires October 28 23:17:01.618 UTC. Hourly and watch-renewal cron jobs remain active. Maintenance returned HTTP 200 at October 21 23:17:03.540 UTC with failures=[] and no pending historical backfill.
- 10 new replies, zero unowned; zero actionable replies missing from the SQL queue; zero duplicate reply communication IDs; zero cross-tenant opportunity links. Historical resolved replies are intentionally not repaired: 79 resolved rows remain unowned.
- 271 Gmail and 6 Resend ambiguity issues remain open. These are review obligations, not evidence that all messages are safely attributed.
- All 9 legacy campaigns inactive, all 3 relationship campaigns execution-disabled; campaign-trigger-worker, relationship-campaign-worker and campaign-scheduler-15min cron jobs remain inactive.
- Calendar observation flag=false and no relationship Calendar watch channels. Active OAuth connections alone do not establish working reconciliation. Calendar was not enabled by this change.
- Daily watch table has an October 21 `ok` record created 21:37:28 UTC. Cron jobs 107/108 have no run rows and watchdog alerts table is empty. This is NOT first scheduled execution or failure-alert delivery acceptance. Next scheduled Central-time acceptance windows are October 22 at 8 AM and 10 AM.
- Unsigned browser navigation to the CRM reply queue redirects to `/auth`; no signed-in operator session is available in the accessible browser.

## Confirmed defects and scoped changes

1. Draft Gmail messages could pass matching and become `sent` records. Edge processing now rejects DRAFT at metadata and full-content stages; forward migration `20261022001106_relationship_gmail_skip_drafts.sql` independently rejects drafts in the public ingestion RPC. Actual old SQL reproduces draft-as-sent in isolated Postgres.
2. Inbound ingestion without RFC Message-ID relied on stale PL/pgSQL FOUND from the outbound lookup, skipping inbound persistence. Forward migration `20261022001355_relationship_inbound_without_rfc_id.sql` checks the inbound row identity directly and scopes provider-ID lookup to the established tenant and inbound direction. Actual old SQL reproduces NOT NULL communication_id failure; corrected Gmail and Resend paths inherit the existing trigger's owner and deduplicate repeated deliveries.
3. The reply queue hardcoded page=1/pageSize=100 with no navigation. It now offers pagination, resets pagination with filters, and explicitly surfaces missing owners / owner_review_required. No deadline default or send behavior is introduced.
4. An existing source assertion was newline-sensitive on Windows; normalize CRLF only in that test. Production storage SQL is unchanged.

## Verification boundaries

New tests execute actual checked-in correlation, ingestion and owner-trigger SQL in PGlite against minimal synthetic tables. They cover draft/sent coexistence; same-thread ambiguity; exact Message-ID/In-Reply-To/References; inbound-only history; cross-tenant observation exclusion; Gmail/Resend ownership and replay; no-RFC insertion; human/automated classification; actual stop-on-reply cancellation; and owner/organization mismatch cases. Edge orchestration tests use synthetic Google/RPC I/O and deny actual network. UI tests prove paging and review visibility.

The ingestion fixture intentionally stubs lifecycle application and exact-unanchored candidate lookup. It does NOT establish full-schema parity, real JWT authorization, two-organization opportunity lifecycle behavior, true concurrent SQL delivery, or external provider acceptance. Existing campaign worker/scheduler runtime tests exercise mocked transport, policy denials, inactive campaigns, lease ownership, transient/permanent failures and stable provider idempotency; they do not prove complete database policy or cross-engine recipient deduplication.

## Remaining acceptance / executable next steps

| Area | Classification | Required evidence/action |
|---|---|---|
| Pub/Sub transport, full ambiguity retrieval, owner trigger | Already complete | Preserve current configuration; no rebuild |
| Draft/no-RFC/queue fixes | Actual defects corrected in source | Review PR and pass required CI; apply only the two new migrations, deploy shared sync consumers, publish frontend, then compare deployed source/versions |
| #190 two-org To/CC lifecycle | Needs verification / remaining implementation | Extend isolated fixture with actual organization/contact/opportunity/activity functions; prove one physical message, separate org interactions, closed referring opportunity preserved and active guest association. Current generic sent path only inserts the anchor interaction; don't infer cross-org association from CC alone |
| #190 natural canonical ingestion | Needs verification | Observe a naturally arriving relevant reply after deployment, compare Gmail headers/ID, one canonical record/observation, linked org/opportunity, normal push and hourly replay. Do not resend the historical test |
| #205 signed-in operator workflow | External session dependency | Sign into crm.valorwell.org; open Relationship reply queue; verify a review-required row, pagination, assignment/save/version conflict behavior and role/tenant denial. Retain issue until this evidence exists |
| Reply SLA | External policy dependency | Owner must approve response targets and working-hour policy before any default; no dates fabricated |
| Both campaign engines | Needs verification | Run full SQL policy/consent/unsubscribe/limits/sender/retry tests on an approved egress-denied stack; prove no duplicate sends across both engines. Preserve all production gates |
| Calendar | Needs verification / activation decision | Verify intended authorized calendar source and booking reconciliation in isolation before enabling the currently disabled observation flag; do not touch EHR Calendar OAuth |
| CRM/Staff/Client signed-in portals | External session dependency | Exercise real role-specific sessions and redirect/tenant boundaries; anonymous CRM redirect is the only browser proof in this run |
| Daily monitor/watchdog | Time/provider dependency | After October 22 8 AM/10 AM Central, inspect cron job_run_details AND application run/audit/provider result. Failure-alert delivery needs a specifically authorized alert drill; don't send unsolicited email |

## Security Advisor and October 30 grants

Observed: 147 INFO RLS-enabled/no-policy findings, 1 extension-in-public warning, 14 anon-executable SECURITY DEFINER warnings, 306 authenticated-executable SECURITY DEFINER warnings, and disabled leaked-password protection. These are classifications requiring context, not 322 proven vulnerabilities. No password policy or unrelated grants were changed. Gmail ingestion denies anon/authenticated execution and permits service_role; existing owner trigger is enabled.

The [official October 30 change](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically) affects grants on NEW public tables; existing grants remain. Repository Public Schema Grant Safety already validates new-table explicit privileges/RLS. Both new migrations only replace existing functions and preserve their ACLs. Grant guard fixtures and both migrations pass.

Advisor references: [RLS without policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [public extension](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public), [anon function execution](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [authenticated function execution](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

## Release inventory at verification

No production migrations or functions deployed in this run. Observed versions: relationship-gmail-push 146, relationship-google-maintenance 149, relationship-resend-webhook 149, relationship-campaign-worker 153, campaign-scheduler 201, valorwell-daily-exception-watch 9, valorwell-daily-watchdog 2. PR #209 merge abd07ac; PR #210 merge 70f50ab. New PR is intentionally not represented as a merged/deployed release.

Pilot decision: NOT READY for automated outreach acceptance. Keep both engines disabled until scoped fixes are reviewed/deployed and the remaining provider, two-organization, signed-in and cross-engine safety evidence is obtained.

## Final local checks

Full Vitest: 183 files, 1043 tests passed. ESLint src with zero warnings, application/tooling TypeScript checks and production build passed. Build reports the existing large-bundle warning. Public-schema grant guard: 9 fixtures and both new migrations passed.

Post-push hourly fallback observed at October 22 00:17:02.438 UTC (October 21 7:17 PM Central): HTTP 200, failures=[], historicalBackfillPending=false. Sync advanced to 3484491 at 00:17:02.398818 UTC; watch renewed to October 29 00:17:01.877 UTC. Test message still has exactly one review issue and zero observations; new replies remain 10.
