## Goal

Make `crm_campaign_enrollments.current_step` mean one consistent thing everywhere, and display it correctly to the user.

## Definitive decision

**`current_step` = the `step_order` of the last step that was actually sent. `0` means "enrolled, nothing sent yet."**

Then the UI simply renders that number (with special-case labels for `0` and for terminal statuses). No `+1` math anywhere.

### Why this definition (and not the alternatives)

Three options were on the table:

1. **"Next step to send"** — what the enrollment insert currently writes (`1` on enroll).
2. **"Last step sent"** — what this plan picks (`0` on enroll).
3. **"Zero-based index of last sent step"** — what the UI currently assumes.

Option 2 wins for concrete reasons:

- **It matches what the scheduler already writes.** After a step sends, the scheduler sets `current_step = nextStep.step_order` from inside `scheduleNextStep`, and on completion it sets `current_step = currentStep.step_order` (the last step sent). The scheduler is the code that runs most often and touches the most rows — aligning the definition to it means we only fix the two outliers (initial insert + UI), not the hot path.
- **It survives campaign edits.** "Next step to send" breaks the moment someone reorders, deactivates, or inserts a step between sends — the stored number no longer points at a real next step. "Last step sent" is a historical fact and stays valid forever.
- **It makes "completed" self-consistent.** A finished 3-step campaign stores `3`, which is literally the last step that ran. No off-by-one, no "step 4 of 3" nonsense in exports or reports.
- **`0` is a clean sentinel for "not started yet"** and lets the UI show "Not started" instead of a misleading step number during the delay before step 1 fires.

Storing "next step" (option 1) was rejected because it requires the scheduler to look ahead on every write and produces invalid values whenever the campaign definition changes. Storing a zero-based index (option 3) was rejected because `step_order` in `crm_campaign_steps` is 1-based, so a separate 0-based counter would create a second coordinate system for no benefit.

## Changes

### 1. Database — backfill existing rows to the new definition

Existing data was written under mixed semantics. Normalize it in one pass using `crm_campaign_step_logs` as the source of truth (it records what actually sent):

- For each enrollment, set `current_step` = max `step_order` of its step logs where `status = 'sent'`.
- If no sent logs exist, set `current_step = 0`.
- Enrollments with `status = 'completed'` get `current_step` = max `step_order` of the campaign's active steps (guarantees the "last step" invariant even if a log row is missing).

This is a one-time data update via the insert tool (not a schema migration).

### 2. Manual enrollment hook — `src/hooks/crm/useCampaignEnrollments.ts:140`

Change the initial insert from `current_step: 1` to `current_step: 0`.

### 3. Auto-enroll trigger — `enroll_campaign_on_status_change()`

Change the `INSERT INTO crm_campaign_enrollments (... current_step ...) VALUES (..., 1, ...)` to `VALUES (..., 0, ...)`. Migration tool, function replacement only — no table changes.

### 4. Scheduler — `supabase/functions/campaign-scheduler/index.ts`

Replace the current post-send update (line ~845) that writes `nextStep.step_order` with a write of `currentStep.step_order` (the step that was just sent). The completion branch at line 769 already writes `currentStep.step_order` and stays as-is. Net effect: `current_step` monotonically advances 0 → 1 → 2 → … → final, matching reality.

### 5. UI — `src/pages/crm/CampaignEnrollments.tsx:193`

Replace `Step {enrollment.current_step + 1}` with a small helper:

- `status === 'completed'` → "Completed"
- `status === 'cancelled'` → "Cancelled"
- `current_step === 0` → "Not started"
- otherwise → `Step {current_step} of {totalSteps}` (total pulled from the already-joined campaign steps; falls back to just `Step {current_step}` if not available)

This is the only place in the app that renders the step number, so no other UI needs to change.

### 6. Verification

- Query enrollments grouped by `(status, current_step)` before and after backfill to confirm the distribution matches expectations (e.g., no more `current_step = 2` for freshly-responded clients who only received step 1).
- Enroll a test client manually, confirm UI shows "Not started" until the first send, then "Step 1 of N", then advances correctly.
- Trigger an auto-enrollment via status change, confirm same progression.
- Let a short test campaign complete and confirm the row shows "Completed" and stores `current_step = <final step_order>`.

## Out of scope

- No schema changes to `crm_campaign_enrollments` (per the hard rule: columns are fixed).
- No changes to `crm_campaign_step_logs`, `crm_campaigns`, or `crm_campaign_steps`.
- No changes to the auto-cancel-on-status-change trigger or the "one active campaign" partial unique index.
