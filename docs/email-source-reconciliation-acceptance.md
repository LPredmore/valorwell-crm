# Email reconciliation acceptance

This change addresses #214 and the remaining reconciliation behavior in #190. It is source implementation, not a production deployment or historical send attestation.

## Implemented behavior

- Automatic structural repairs require an independently retrieved, exact Gmail ID receipt. The communication, tenant, thread, sender/recipient, sent labels and stored RFC identities must agree. A later message, CRM status or organization association cannot satisfy the gate. The existing audit captures the source receipt; repeated apply is harmless and changes no opportunity stage.
- Only the trusted service ingestion role can record receipts. No historical receipts are backfilled from CRM claims. Full provider responses are checked before flattening headers, including conflicting RFC Message-ID headers.
- Authenticated task cleanup recomputes organization-wide dispositions, including provisional thread associations as blockers and documented source-verified ignored outcomes as finished work. Preview lists tasks. Apply locks source records against concurrent changes, preserves the existing task trigger, and retains historical task links when a subsequent issue creates a fresh task.
- Read-only, tenant-scoped recovery and diagnostics RPCs expose exact identity status, evidence references, repair eligibility, source limitations, last successful sync, push activity, error and elapsed time since sync. This elapsed time is not a measured end-to-end delivery latency.
- Exact message retrieval failures are retained as idempotent exceptions. Permission errors fail the sync without advancing its cursor; 404 is explicitly not evidence of deletion. Failures are visible in synchronization state.
- Secondary To and CC recipients produce separate organization interactions without duplicating the physical email or changing stages. Ambiguous secondary recipients retain a review exception.
- Existing push authentication, hourly fallback, complete-header ingestion, history replay deduplication, draft exclusions, campaign controls and no-send behavior remain in place.

## Recovery procedure

The application inventory reads issues, triage, communications, observations/RFC identities, CRM email records, activity events, prior source-review metadata and new provider receipts. Old records are leads, never promoted into authoritative receipts. No mailbox bodies are included in the report.

Export the JSON result of `get_relationship_email_source_recovery()` through an authenticated CRM session. For an independent provider recheck, use an externally supplied OAuth access token for **info@valorwell.org** with `gmail.readonly` scope. Keep it in `GMAIL_READONLY_ACCESS_TOKEN`; never put it in command arguments or commit it.

```powershell
node scripts/relationship-email-source-recovery.mjs inventory.json source-report.json
```

The command verifies the mailbox profile first and uses only GET requests. It checks each exact original ID and searches stored RFC IDs when retrieval fails. Search candidates are never merged or substituted. Output creation refuses to overwrite an existing report. The command never writes to Supabase and never declares a CRM association safely repairable; use the audited database preview for that separate decision.

Google documents [exact message retrieval](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get) and [RFC Message-ID search](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list). Search requires a scope that permits queries, such as `gmail.readonly`; `gmail.metadata` alone does not permit `q` searches.

## Validation and limits

The isolated PGlite suite executes the new SQL functions and the existing task-validation trigger. Its authentication boundary is an explicit test double, not a real signed JWT. Provider tests run the actual Edge orchestration against controlled I/O; CLI tests use a fake HTTP transport. UI tests exercise preview, completion and read-only evidence. These synthetic fixtures are never evidence of production delivery.

Coverage includes seven unsafe candidates; later same-thread sends; exact audited/idempotent repair; conflicting RFC identity; recipient mismatch; draft labels; tenant separation; authorized/unauthorized task mutation; resolved and source-verified ignored dispositions; preview becoming ineligible before apply; preserved historical links and new task linking; provider 404/403/unavailable/mismatch; repeated notifications; secondary To/CC interactions and ambiguity; and unknown diagnostic timestamps. Existing ingestion/campaign tests cover no unintended stage changes, sends or activation.

Production records were inspected read-only. The local per-issue inventory is deliberately outside the repository. No historical issue was resolved, no review task was completed, and no message was sent during implementation. Provider records still unavailable require mailbox access or independent original-source records; thread membership cannot remove that requirement.

## Reviewed release instructions

After PR review and explicit rollout authorization:

1. Merge the reviewed commit. Use the normal migration release process. The four migrations in this change are:
   - `20261022195806_relationship_source_identity_gate.sql`
   - `20261022195848_relationship_review_organization_completion.sql`
   - `20261022195938_relationship_source_recovery_report.sql`
   - `20261022200829_relationship_secondary_to_recipients.sql`
2. Before applying, run `supabase migration list --linked` and `supabase db push --dry-run --linked` against the approved linked project. Confirm the pending set is exactly the reviewed release. If unrelated migrations are pending or history diverges, stop and use the repository's migration-recovery process; do not repair the ledger speculatively. Apply the approved set with `supabase db push --linked` only after this check.
3. Deploy `relationship-gmail-push` and `relationship-google-maintenance` **after the database migrations**, because the shared sync code calls the new receipt/failure RPCs. Commands: `supabase functions deploy relationship-gmail-push --project-ref ahqauomkgflopxgnlndd` and `supabase functions deploy relationship-google-maintenance --project-ref ahqauomkgflopxgnlndd`. Keep the configured push JWT/OIDC behavior unchanged. The calendar webhook shares the module but does not invoke Gmail processing; no calendar activation is needed.
4. Release the frontend through the normal application pipeline. Sign in as a CRM operator with `edit_relationships`; open `/crm/business-development/orchestration/reconciliation`, inspect the live task preview, then use **Complete finished review tasks**. Counts must be recomputed rather than hard-coded.
5. Confirm the source report and Gmail diagnostics load. Perform signed-JWT acceptance on an approved isolated stack with enforced egress denial before production acceptance. SQL role simulation is not a substitute. Do not enable campaigns or send synthetic production email as part of these checks.
6. Only if new genuine source receipts are available, have an authorized service operator preview `private.reconcile_anchored_relationship_email_links(false,100)`. Review receipt provenance before the separate audited apply call. The implementation does not automatically run this repair or rewrite disputed provider IDs.

No OAuth/Pub/Sub reconfiguration or campaign activation is required by this patch. If provider access is denied, restore access to the original mailbox before rerunning source recovery; never substitute another account's message IDs.
