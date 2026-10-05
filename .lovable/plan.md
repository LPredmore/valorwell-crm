# Newsletter Fixes Plan

Fix the five open newsletter findings from Project monitoring, keeping every change compatible with the existing canonical Email Studio storage, suppression checks, and automation-event logging.

## 1. Scheduled newsletters can't be cancelled (detected 20260908)
- In `src/pages/crm/NewsletterManagementPage.tsx`, move the **Cancel send** button out of the `letter.canonical` gate: show it for any newsletter whose status is `scheduled` or `sending`, exactly like the pre-redesign behavior.
- Editing stays canonical-only (legacy newsletters genuinely can't open in Email Studio), but cancellation must never depend on that.
- Verify the cancel RPC works for non-canonical rows; if it requires canonical content, adjust it to cancel by id + status only.

## 2. Newsletters never actually send (detected 20260815)
- `newsletter-send-worker` exists but nothing invokes it. Add a pg_cron + pg_net schedule (every 5 minutes) that POSTs to the worker with the project publishable key, using the standard project cron pattern (job name `newsletter-send-worker`, via `supabase--run_sql` since the URL/key are project-specific).
- Deploy the worker, then verify end to end: schedule a test newsletter a few minutes out and confirm it transitions scheduled → sending → completed with real Resend delivery records.
- Add a "last worker run" indicator on the Newsletters page so staff can see the sender is alive.

## 3. Template attribution silently lost (detected 20260910)
- Root cause: the composer's mount-time compliance-footer repair fires `onDirty`, and the bulk dialog wires `onDirty` to `clearTemplateAttribution`.
- Fix: in `ClientNewsletterEmailStudioComposer.tsx`, the load-repair effect must not call `onDirty` — the repair is a system normalization, not a user edit. Autosave already persists the repaired document, so nothing is lost.
- Keep `onDirty` for genuine user edits only. Add a regression test: apply a template with a stale footer, confirm `templateId`/`templateVersionId` survive and the send records the template.

## 4. Missing audiences: Relationship contacts + Provider applicants (detected 20260908)
- Frontend: restore all six domains in `src/lib/crm/newsletter-control-plane.ts` (`client, staff, donor, relationship, bty, provider_applicant`) with labels, matching `communications-control-plane.ts`.
- Backend: the production `crm_newsletter_audience_preview` and `crm_upsert_newsletter_canonical` only accept 4 domains, while the earlier migration (`20260814233410`) supports all 6. One forward-dated migration re-applies the 6-domain definitions of the preview function and the canonical upsert validation, so saved drafts with those audiences display, count, and send correctly.
- Verify the preview counts match what actually sends for each restored audience.

## 5. Editor doesn't fit the bulk send dialog (detected 20260908)
- `ClientNewsletterEmailStudioComposer` is shared between the full-screen workspace and `BulkNewsletterDialog`. Add a `layout="workspace" | "dialog"` prop:
  - workspace (default): current three-column grid, unchanged.
  - dialog: single-column stacked layout (block list collapsible above the canvas, settings below), no fixed 1180px minimum, no nested scroll regions.
- Restore the EmailStudioToolbar inside dialog mode so the bulk flow keeps its previous controls.

## Verification
- All existing tests pass; new regression tests for #1, #3, #4.
- Typecheck + lint clean.
- Live verification of the send worker (#2) with a real scheduled test send before marking done.

## Out of scope
- The other 8 open findings (SMS message class, campaign save-on-collapse, publication cover, Drive connect, BTY Automation page, campaign first-name, interest filter, reports names) — separate plan on request.
