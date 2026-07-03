# Capture the real ClickUp error

## Why

You asked for HTTP status, response body, response headers, and rate-limit headers. I don't have any of that on file. The current `clickup-sync` edge function:

- reads `res.status` but only embeds it in a thrown `Error` string
- JSON-parses the body but discards everything except what it echoes into the error message
- never reads response headers at all
- log retention for the function has already lapsed, so I can't recover the original backfill's traces

So the only correct next step is to instrument the function and make a fresh, minimal call against ClickUp to capture the exact response.

## Change 1 — Instrument `clickup()` in `supabase/functions/clickup-sync/index.ts`

Update the helper so every ClickUp call records the full response envelope:

- capture `res.status` and `res.statusText`
- capture **all** response headers via `Object.fromEntries(res.headers.entries())`
- capture the raw response body as text (before JSON parsing)
- `console.log` a single structured line per call:
  ```
  {
    "clickup_call": true,
    "method": "...",
    "path": "...",
    "status": 429,
    "statusText": "...",
    "headers": { ... },      // full header map, incl. x-ratelimit-*, retry-after, x-trace-id
    "body_raw": "..."         // first 2 KB
  }
  ```
- return status/headers/body alongside `ok` so callers can propagate them

Also update `createTask` / `updateTask` / `setCustomField` error paths to include `status` and the captured header subset (`x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset`, `retry-after`) in the thrown `Error` message, so even without log access the caller's JSON response carries the evidence.

## Change 2 — Add a diagnostic action to the same function

Add `action: 'diagnose'` that:

1. Calls `GET /list/{list_id}` — cheapest read, confirms auth + list access.
2. Attempts `POST /list/{list_id}/task` with a throwaway payload (`name: "lovable-diagnostic-<timestamp>"`, no custom fields).
3. If the create succeeds, immediately `DELETE /task/{id}` to leave no residue.
4. Returns a JSON envelope containing, for each call: `status`, `statusText`, full `headers` map, and raw `body`.

This gives us the exact evidence you asked for without touching the 621 unsynced clients and without depending on log retention.

## Change 3 — Deploy and invoke

Deploy the updated function, then invoke `{ action: 'diagnose' }` from Settings (or via `curl_edge_functions`). Report back with the raw status/headers/body verbatim — no interpretation until you've seen them.

## Explicit non-goals

- No retry logic, no backfill resumption, no ClickUp plan/tier assumptions in this change. Purely diagnostic. Any decisions about upgrading, archiving, or changing item types wait until we have the real HTTP envelope in hand.
