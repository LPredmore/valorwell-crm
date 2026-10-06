# ValorWell CRM: Open Monitoring Findings Report (AI-ready)

Generated: 2026-10-06. Repo: ValorWell CRM (React + Vite + external Supabase `ahqauomkgflopxgnlndd`, tenant `00000000-0000-0000-0000-000000000001`).
Scope: 12 Project monitoring findings still pending. The five newsletter findings were fixed and resolved on 2026-10-05, so they are not listed here.
Date format: YYYYMMDD, the date of the commit range in which the issue was detected.

## Constraints for any AI fixing these
- Shared Supabase serves the Clients, Staff, CRM, Billing and Onboarding apps. Only make additive DB changes. Never rename or drop shared columns or enum values.
- New CRM tables must use the `crm_` prefix. Log activity only through Edge Functions.
- Display names as `pat_name_preferred`, falling back to `pat_name_f` + `pat_name_l`.
- Do not use Lovable Cloud. Do not change CORS `resolveAllowHeaders` or CRM operating-context auth.
- Work diagnosis-first: re-verify each finding against current code before editing.

## Status overview

```text
ID-prefix  Sev     Detected  Status (re-checked 20261005)   Title
53311be0   high    20260809  ALREADY FIXED -> resolve stale  Google connect lands on 404
6b6b510a   high    20260710  ALREADY FIXED -> resolve stale  "Active" clients mislabeled
d85acb94   high    20260703  ALREADY FIXED -> resolve stale  Off-hours campaign msgs stuck
0ff555cf   medium  20260923  ALREADY FIXED -> resolve stale  Evening posts on wrong day
31e5cfed   high    20260724  OPEN                           Collapsed email step breaks Save
82bc14ef   high    20260717  OPEN                           SMS messageClass hardcoded
417950e3   medium  20260923  OPEN                           Publication editor broken cover
a10fa9c7   medium  20260921  OPEN                           Connect Google Drive rejected
9b8a2f62   medium  20260820  OPEN                           BTY Automation page orphaned
b64c3aeb   medium  20260724  OPEN                           Campaign email uses legal name
0899cd59   medium  20260718  OPEN                           Interest queue Source filter empty
95afd570   medium  20260715  OPEN                           Reports show raw UUIDs
```

## Already fixed (only need resolving as `stale`)
- **53311be0**: the OAuth callback now redirects to the Orchestration page, which exists.
- **6b6b510a**: the `Active` value no longer exists in client data, so nothing is mislabeled.
- **d85acb94**: the campaign scheduler now re-queues off-window logs 15 minutes later instead of leaving them in `processing`.
- **0ff555cf**: the calendar now groups days by America/Chicago.

## Open issues

### 1. 31e5cfed (high, 20260724): collapsing an email step breaks Save Campaign
- Files: `src/components/crm/campaigns/CampaignStepEditor.tsx`, `src/pages/crm/CampaignEditor.tsx`.
- Cause: `ClientCampaignEmailStudioComposer` sits inside Radix `CollapsibleContent`, which unmounts when closed. The exporter that the step registers via `registerExporter(step.client_key, ...)` is not tied to `isOpen`. On save, `exportCurrentSteps` calls every exporter. For a collapsed step `studioRef.current` is null, so the exporter throws "Step N contains invalid Email Studio content", and `handleSave` aborts before any write.
- Fix direction: keep the composer mounted (`forceMount` + hidden), or when it is unmounted, have the exporter return the last captured `step.email_content`. Add a test that collapses a step and then saves.

### 2. 82bc14ef (high, 20260717): SMS always sent as `necessary_scheduling`
- Files: `src/repositories/supabase/communications.ts` (SMS branch of `send`), `src/components/crm/canonical/PolicyAwareComposer.tsx`, `supabase/functions/crm-send-client-sms/index.ts`.
- Cause: the SMS payload hardcodes `messageClass: 'necessary_scheduling'` and ignores `msg.messageClass`. As a result, server-side `checkSuppression` and `crm_activity_events.metadata.message_class` both use the wrong class, and suppression rules for promotional and follow-up classes are bypassed. The email branch forwards the value correctly.
- Fix direction: forward `msg.messageClass ?? 'necessary_scheduling'`. On the server, validate the value against the `MessageClass` allow-list. Add a test.

### 3. 417950e3 (medium, 20260923): Publication editor shows a broken cover image
- Files: `src/components/crm/social-media/SocialPublicationMetadataForm.tsx`, `supabase/functions/social-media-manager/handlers/thumbnail-edit.ts`.
- Cause: the form renders `<img src={publication.thumbnailUrl}>`, which is a private Drive `/file/d/ID/view` HTML page, not image bytes.
- Fix direction: reuse the `SocialMediaThumbnail` component and the `get_thumbnail_url` signed-URL action, adding a `publication` source type that resolves its file ID server-side under tenant scope. Show a blank neutral box when there is no cover.

### 4. a10fa9c7 (medium, 20260921): "Connect Google Drive" rejected before it starts
- Files: `supabase/functions/relationship-google-oauth-start/index.ts`, `relationship-google-oauth-callback/index.ts`, and the check constraints from migration `20260809164922`.
- Cause: the start endpoint only allows `gmail|calendar` and has no `drive` scope. The OAuth state table and `relationship_google_connections` have CHECK constraints that allow only gmail and calendar. The callback already has a full drive branch.
- Fix direction: add `drive` (scope `drive.readonly`) to the start endpoint. Write an additive migration that widens both CHECK constraints and `store_relationship_google_connection`. Check first that no other app depends on these constraints.

### 5. 9b8a2f62 (medium, 20260820): BTY Automation page orphaned
- Files: `src/pages/crm/business-development/BtyAutomationPage.tsx`, `src/lib/crm/bty-automation.ts:81`, `src/components/crm/layout/CrmSidebar.tsx:54`, `src/App.tsx:104`.
- Cause: migration `20260820161925` dropped the `bty_automation_overview` RPC and the related cron jobs and functions. The page still calls the RPC and still says "Daily 6:00 AM discovery". Confirmed live: the RPC count in `pg_proc` is 0.
- Fix direction: remove the rotation and runs sections and the misleading copy. Keep the duplicate-cleanup section, which still works (`bty_preview_organization_duplicates`, `bty_merge_organization_duplicates`). Rename the sidebar entry, for example to "BTY Duplicate Cleanup".

### 6. b64c3aeb (medium, 20260724): campaign emails use legal first name
- Files: `supabase/functions/campaign-scheduler/index.ts`, `email-content.ts`.
- Cause: the email path sets `values.first_name = pat_name_f || "Client"`, which drops the old fallback `pat_name_preferred || pat_name_f || "there"`. The SMS path still uses the old logic.
- Fix direction: restore `first_name = pat_name_preferred || pat_name_f || "there"` for email and keep `{{preferred_name}}`. Add a scheduler unit test.

### 7. 0899cd59 (medium, 20260718): interest queue Source filter returns nothing
- Files: `src/pages/crm/canonical/CreatorCommunityInterestQueue.tsx:87`, `src/lib/crm/creator-community-interest.ts`.
- Cause: the `<option>` has no `value`, so the filter receives the formatted label instead of the raw source code, and the strict equality in `recordHasSource` never matches.
- Fix direction: add `value={value}` to the option. Add a filter test.

### 8. 95afd570 (medium, 20260715): Reports show raw UUIDs
- Files: `src/pages/crm/canonical/CanonicalReports.tsx`, `src/repositories/supabase/reports.ts`, `src/repositories/types.ts`.
- Cause: the views `v_crm_reports_campaigns` and `v_crm_reports_tasks` expose only `campaign_id` and `assignee_id`, and the repository does not join to get names.
- Fix direction: resolve names in the repository with batched lookups (`crm_campaigns.name`, staff/profile display name), then render names with the UUID as a fallback. No view changes are needed, which avoids impact on the shared DB.

## Suggested execution order
1. Resolve the 4 already-fixed findings as `stale`.
2. High: #2 (SMS class, compliance risk), then #1 (campaign save).
3. Quick wins: #7, #6, #8.
4. Then #3, #5, #4 (#4 needs a migration and a cross-app check).

Verification for every fix: targeted vitest, full suite (baseline 609/609), `tsgo` typecheck, lint, Edge Function deploys where touched, then `project_monitoring--resolve_finding`.
