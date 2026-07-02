## CRM Follow-Up Audit — Implementation Plan

The prior Critical/High security pass is holding. A follow-up audit surfaced 15 remaining items across correctness, tenant isolation, performance, and code quality. This plan sequences the fixes so each phase is independently shippable, keeps shared EHR tables untouched, and avoids any change that could ripple into the other apps sharing this database.

Every DB change proposed here is **additive-only** on tables the CRM owns (`crm_*`) or on `public.clients` in the form of a new **index** (no column changes). Nothing in this plan alters, drops, or renames an existing column.

---

### Phase 1 — Critical fixes (no schema changes)

**1. Remove the hardcoded Supabase URL** — `src/lib/crm/helpscout-api.ts:3`
`HELPSCOUT_PROXY_URL` is a literal `https://ahqauomkgflopxgnlndd.supabase.co/…`. Any env swap silently breaks Inbox and replies.
**Fix:** `` `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/helpscout-proxy` ``. Same pattern already used elsewhere.
**Why this over `supabase.functions.invoke`:** the proxy relies on query-string action routing and streaming JSON; `invoke` forces a POST body shape that would require rewriting every call site. Env-driven URL is the minimum, correct change.

**2. Cache the HelpScout OAuth token in `helpscout-proxy`**
`getAccessToken()` runs on every HelpScout call — up to 10 token exchanges per `list-conversations` request. Wastes rate-limit budget and adds latency inside the 10s edge-function ceiling.
**Fix:** Module-scoped `{ token, expiresAt }` cache; refetch only when `Date.now() > expiresAt - 60_000`. Concurrent-safe with a shared in-flight promise so parallel requests share one refresh.
**Why not Deno KV or DB-backed cache:** HelpScout tokens are per-function-instance cheap to mint; module scope survives warm invocations, which is exactly the hot path we care about. KV adds latency and cost with no correctness gain.

---

### Phase 2 — Correctness & tenant isolation (1 additive migration)

**3. Prevent duplicate `scheduled` step logs** — `crm_campaign_step_logs`
`SKIP LOCKED` prevents double-*claim*, not double-*insertion*. If the scheduler retries after a partial commit, two `scheduled` rows for the same `(enrollment_id, step_id)` can be created and both later claimed.
**Migration (additive index):**
```sql
CREATE UNIQUE INDEX IF NOT EXISTS crm_campaign_step_logs_one_scheduled
  ON public.crm_campaign_step_logs (enrollment_id, step_id)
  WHERE status = 'scheduled';
```
Then switch `scheduleNextStep` in `campaign-scheduler/index.ts` to `.upsert(..., { onConflict: 'enrollment_id,step_id', ignoreDuplicates: true })` — only effective while `status='scheduled'` because of the partial index.
**Why a partial unique index over a full unique constraint:** completed/failed rows must remain multiple (retries, historical audit). Partial index gives exactly-once *scheduling* without corrupting history.

**4. Add explicit `tenant_id` filter to outbound SMS queries** — `src/hooks/crm/useSmsConversations.ts`
Currently relies purely on RLS. Add `.eq('tenant_id', tenantId)` to the `crm_bulk_sms_recipients` and `crm_campaign_step_logs` queries as defense-in-depth. Remove the JS-side post-filter `r.bulk_sms?.tenant_id === tenantId` once the server-side filter is in place.

**5. Fix inbound SMS tenant fallback** — `ringcentral-sms/index.ts:495`
Currently assigns a hardcoded `DEFAULT_TENANT_ID = '00000000-...-0001'` when no client match is found. This either FK-fails silently or (worse) mis-attributes messages if that UUID happens to match a real tenant.
**Fix:** Look up the RingCentral extension → tenant mapping from `crm_helpscout_settings`/an equivalent RC config row. If still unresolved, insert with `tenant_id = NULL` **conditional on the column being nullable** (see below).
**Schema question (needs your approval):** `crm_inbound_sms_logs.tenant_id` is currently `NOT NULL`. The safest additive change is:
```sql
ALTER TABLE public.crm_inbound_sms_logs ALTER COLUMN tenant_id DROP NOT NULL;
```
This is CRM-owned and not touched by the other apps — but I will confirm with you before running it. If you'd rather not relax the column, the fallback is to **drop** unmatched inbound messages with a warning log; that's strictly worse for auditability but requires zero schema change.

**6. Add tenant ownership check to `create-conversation`** — `helpscout-proxy/index.ts`
Unlike `reply` (which validates `callerBelongsToTenant`), `create-conversation` accepts any `customerEmail` and writes no activity event. Fix:
- Resolve the client via `find_clients_by_emails_insensitive` scoped to the caller's tenant memberships; reject 403 on miss.
- Log an `email_sent` activity event mirroring the `reply` action.

**7. Fix `list-conversations` fan-out** — `helpscout-proxy/index.ts`
Currently: up to 10 HelpScout page fetches × 1 RPC each = 20 sequential round-trips per request. Risk of 504.
**Fix:** Fetch pages in a loop, accumulate emails into a `Set`, then call `find_clients_by_emails_insensitive` **once** with the deduplicated email set before filtering. Reduces N×2 round-trips to N+1.
**Why not parallelize page fetches:** HelpScout paginates with cursor semantics; the next page depends on the previous page's cursor. Sequential is required; the win is collapsing the RPC calls.

---

### Phase 3 — Performance & UX consistency (no schema changes)

**8. Batch `useBulkUpdateStatus`** — replace the per-client `Promise.all` of `UPDATE` + `INSERT` (2×N round-trips) with:
- One `UPDATE clients SET pat_status=$1 WHERE id = ANY($2) AND tenant_id=$3`.
- One `INSERT INTO crm_activity_events` with an array of rows.
Wrap both in a single Postgres RPC `crm_bulk_update_client_status(ids uuid[], new_status text, tenant_id uuid)` so the two writes are transactional — if the audit insert fails, the status update rolls back.

**9. Fix `useSaveCampaignSteps` partial-failure hole** — sequential update loop that silently leaves campaigns half-saved on any error. Wrap the delete/insert/update batch in a single RPC `crm_save_campaign_steps(campaign_id uuid, steps jsonb)` so partial saves are impossible. Client-side, drop the client-generated step IDs and use whatever the RPC returns.

**10. Surface `useSmsConversations` errors** — currently swallows all three sub-query errors and returns `[]`, which react-query treats as success. Rethrow when the inbound query (the primary data source) fails; log-and-continue for the two outbound sources (secondary enrichment). This preserves partial rendering when only enrichment fails but surfaces true outages.

**11. Move `useClients` filters server-side** — `activeCampaign` and `communicationReceivedDays` are currently applied in JS after fetching the full client list. For large tenants this fetches thousands of rows to discard most of them.
**Fix:** Add `EXISTS` subquery filters via a `crm_search_clients` RPC that accepts the filter payload and returns matching rows. Keep the existing hook signature; only the query body changes.

---

### Phase 4 — Cleanup (no schema changes)

**12. Tag filter correctness** — `useClients.ts:65` uses `ilike %VIP%` which matches `"Non-VIP"`. Per project memory, tags live in a single TEXT column `clients.tags` and I cannot alter that column.
**Fix (no schema change):** Change the filter from `ilike.%${tag}%` to an exact-match against the delimited value: `.or('tags.eq.<tag>,tags.ilike.<tag>,%,tags.ilike.%,<tag>,tags.ilike.%,<tag>,%')` — i.e., match the tag when it is the whole value or a token bounded by commas. Not indexable, but correct. If you later approve migrating `clients.tags` to `text[]`, we can add a GIN index; but that column is on the shared `clients` table and per your rules is off-limits.

**13. `useCampaigns` sequential queries** — wrap the step-count and enrollment-count queries in `Promise.all` (already correctly batched pattern used elsewhere).

**14. Remove CORS from `campaign-scheduler`** — it's cron-only via `X-Cron-Secret`. Delete `corsHeaders` and the OPTIONS handler.

**15. `create-conversation` activity log** — folded into item 6.

---

### Rollout order

1. **Phase 1** (items 1–2) — safest, zero-schema, high impact. Ship immediately.
2. **Phase 2** (items 3–7) — one additive migration (partial unique index) + a **decision point** on `crm_inbound_sms_logs.tenant_id` nullability. Deploy `helpscout-proxy`, `ringcentral-sms`, `campaign-scheduler` together.
3. **Phase 3** (items 8–11) — two new RPCs (`crm_bulk_update_client_status`, `crm_save_campaign_steps`, `crm_search_clients`). All CRM-scoped, additive.
4. **Phase 4** (items 12–14) — pure code cleanup.

### Decision I need from you before Phase 2

- **Item 5:** Approve `ALTER TABLE public.crm_inbound_sms_logs ALTER COLUMN tenant_id DROP NOT NULL`? This is a CRM-owned table so no cross-app risk, but it is technically a column change. If you'd prefer to keep the NOT NULL constraint, I will implement the "drop unmatched inbound with warning" fallback instead — worse for audit, but zero schema movement.

### Out of scope

- Anything touching shared EHR tables (`clients`, `appointments`, `staff`, etc.). Per project rules.
- The `SECURITY DEFINER` view warnings from the linter — intentional for tenant-scoped aggregates.
- Missing RLS on shared tables — owned by the other apps.
