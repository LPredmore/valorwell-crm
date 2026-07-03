## Root cause (diagnosis)

The published site is up to date, so the button exists and the fetch does leave the browser. What's happening is exactly what the error string says: **the browser fetch to the Edge Function fails before a response comes back**.

Two structural reasons, both baked into the current backfill design:

1. **The backfill runs synchronously in one HTTP request.** `runBackfill` in `ClickUpConfigPanel.tsx` calls `supabase.functions.invoke('clickup-sync', { body: { action: 'backfill' } })` with no `limit`. The function then defaults to `limit: 50` and, inside a `for` loop, calls `syncOne` per client — each client is ~10 ClickUp HTTP calls (create/update task + one PUT per custom field). That's ~500 sequential outbound HTTP calls in one invocation.
2. **ClickUp caps us at 100 requests/minute.** 500 calls at 100/min = ~5 minutes minimum. Supabase Edge Functions and the `supabase-js` invoke fetch both cut off well before that (the CPU/wall budget on Edge Runtime is ~150 s and the browser-side fetch is aborted around the same window). When the function is still running, the fetch is terminated client-side and `supabase-js` surfaces exactly the `FunctionsFetchError: Failed to send a request to the Edge Function` you saw. From the preview earlier this manifested the same way, which is why the panel-driven run "worked" only when I invoked it externally in tiny batches.

The diagnose run at 06:30 UTC succeeded because it makes only 3 ClickUp calls and returns in ~4 s. That's why the same function/URL/CORS works for diagnose and fails for backfill — the failure isn't auth, CORS, or deploy freshness. It's request duration.

## The decision

**Convert backfill to a paced background job with a persisted progress row that the UI polls.** Not a client-side batch loop.

Why this over the alternatives:

- **Client-side "call backfill with limit=20 in a loop"** works but is fragile. If the user closes the tab, navigates away, or the laptop sleeps, the backfill halts partway through and there's no record of where it stopped. On mobile it will definitely stall. It also hammers the function with N invocations, each subject to the same auth/CORS surface.
- **A cron-driven drain queue** is the heaviest option and is overkill for a one-off (occasionally re-run) full-list resync of ~641 records.
- **Background job on the same edge function using `EdgeRuntime.waitUntil`, returning `202` with a `run_id` immediately, writing progress to a `crm_clickup_sync_runs` row, and pacing internally to respect ClickUp's 100/min limit** — this is the pattern Supabase explicitly supports for "long tail after HTTP response" work, matches how the existing scheduler + activity logging are architected (single edge function is the source of truth), and gives the user a real progress bar that survives tab closes. It also naturally rate-limits so we never trip ClickUp's `429` or the `ITEM_246` cap in a burst.

This is the right choice because the problem isn't "the fetch failed" — it's "we tried to do a 5-minute job inside a single HTTP request." Every band-aid that keeps the work inside the request (bigger timeout, retry, smaller batch) is fighting the wrong wall. Moving the work off the request is the fix.

## Implementation plan

### 1. New table: `crm_clickup_sync_runs` (additive, follows `crm_` prefix rule)

```text
id                uuid PK
tenant_id         uuid null
status            text  -- queued | running | completed | failed | cancelled
total             int   default 0
processed         int   default 0
created_count     int   default 0
updated_count     int   default 0
recreated_count   int   default 0
skipped_count     int   default 0
failed_count      int   default 0
last_error        text  null
started_at        timestamptz default now()
finished_at      timestamptz null
triggered_by     uuid null      -- auth.uid()
options          jsonb          -- { only_unsynced, tenant_id, limit }
```

Grants: `authenticated` gets `SELECT`; `service_role` gets `ALL`. RLS: authenticated users in a tenant can SELECT their tenant's runs (and rows with `tenant_id IS NULL` triggered by them). Only edge function (service role) writes.

### 2. `supabase/functions/clickup-sync/index.ts` changes

- Add action `backfill` behavior: insert a `crm_clickup_sync_runs` row with `status='queued'`, resolve the client id list (respect `tenant_id`, `only_unsynced`), set `total`, flip to `running`, then return `{ run_id, total }` with HTTP 202 **immediately**.
- Kick the loop off via `EdgeRuntime.waitUntil(processRun(run_id, ids, fieldMap))`.
- Inside `processRun`: iterate clients, call `syncOne`, increment the appropriate counter columns on the run row after each client (single `update` per client, cheap), and **pace** — a small `await sleep(700)` between clients keeps us comfortably under ClickUp's 100/min ceiling and avoids the `ITEM_246` burst risk. On any thrown error inside the loop, increment `failed_count` and record `last_error`; do not abort the whole run.
- Add action `backfill_status` (`{ run_id }`) that returns the current row; used only as a fallback — normally the UI subscribes via Realtime.
- Add action `cancel_backfill` (`{ run_id }`) that sets `status='cancelled'`; the loop checks this flag every N clients and exits cleanly.
- Keep `diagnose` unchanged and still auth-optional.

### 3. `ClickUpConfigPanel.tsx` UX

- Click "Sync all clients now" → call `backfill`, receive `run_id`, store it, disable the button while a run is `queued`/`running`.
- Subscribe to `crm_clickup_sync_runs` for that `run_id` via Supabase Realtime (inside a `useEffect` with `removeChannel` cleanup, per project convention). Fall back to a 3 s poll if the row hasn't changed in 15 s.
- Show progress bar: `processed / total`, plus a compact line "created X · updated Y · recreated Z · failed F".
- Add a "Cancel" button while running.
- On mount, look up the most recent run for this tenant and re-attach if it's still `running` — so refreshing the tab or coming back later shows live progress.
- Keep the existing "Required custom fields" and `lastResult` panels; render the last completed run summary there instead of raw JSON.

### 4. Realtime enablement

`ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_clickup_sync_runs;` in the same migration.

### 5. Verification

- Deploy function, run backfill from the published site with only 5 unsynced clients (temp `limit: 5`) — expect immediate 202, progress row ticks 1→5, ClickUp task_count rises by 5.
- Run full 621-client backfill from the published site, close the tab, reopen Settings → progress bar reattaches and continues.
- Confirm no `ITEM_246` and no `429` in `clickup_call` logs during a full run.

## Technical notes

- We are **not** modifying any existing columns on `clients` or any shared table. `crm_clickup_sync_runs` is a new CRM-prefixed table with its own foreign-keyed `tenant_id`.
- Pacing at 700 ms/client gives ~85 req/min against the 100/min ClickUp ceiling with headroom for retries.
- `EdgeRuntime.waitUntil` keeps the isolate alive after the response is sent; this is the documented Supabase pattern for post-response work and is already used elsewhere in the codebase for logging.
- No frontend business-logic changes outside `ClickUpConfigPanel.tsx`. No changes to `syncOne`, the per-client triggers, or the `clickup_task_id` idempotency contract.
