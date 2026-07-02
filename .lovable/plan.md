## Goal

Make two facts that the database already knows visible and reliably queryable:

1. **Last Contact** — the most recent time email or SMS was sent to or received from the client.
2. **Campaign History** — every campaign the client has ever been enrolled in.

## Definitive technical decisions

### 1. Add `last_contact_at TIMESTAMPTZ NULL` to `clients` and maintain it with a trigger on `crm_activity_events`

Now that `clients` may be extended additively, storing the value denormalized wins over deriving it. Reasons:

- **Read cost dominates.** This value gets rendered on the client profile, the quick-profile sheet, and (as a sortable/filterable column) the clients table. A denormalized column is one field read; a view aggregating `crm_activity_events` (~thousands of rows already, growing daily) is a `GROUP BY` scan every time. At CRM list scale (hundreds of visible rows per page, snappy sort/filter) the difference is felt.
- **Write path is already funneled.** Per the activity-logging memory, all four event types are written exclusively by three edge functions. A single **`AFTER INSERT` trigger on `crm_activity_events`** filtered to those four types is the *only* writer of `last_contact_at`. Edge functions stay untouched, no application code needs to remember to update anything, and there is no drift risk.
- **Sorting/filtering by "last contact" becomes trivial.** A future "clients I haven't touched in 30 days" filter is `WHERE last_contact_at < now() - '30 days'::interval` — index-friendly and identical to how the existing `status_changed_at` column is used.

Rejected alternatives:
- **View / materialized view** — either slow at read (regular view) or needs a refresh strategy (materialized view) for no benefit given the trigger option exists.
- **Client-side aggregation** — N+1 or bulk-pulls the activity table into the browser; unacceptable on the table page.

Also add `last_contact_direction TEXT` (`'sent'` | `'received'`) and `last_contact_channel TEXT` (`'email'` | `'sms'`) written by the same trigger, so the profile can render "2 days ago · Email received" without a second query.

### 2. Show Campaign History by querying `crm_campaign_enrollments` directly

No new column or table needed — history is already there. A new `CampaignHistoryCard` on the client profile lists every enrollment (all statuses), ordered by `enrolled_at DESC`, joined to `crm_campaigns` for the name. A single hook, no denormalization.

### 3. Close the manual-enrollment audit gap

The auto-enroll trigger writes `campaign_auto_enrolled` to `crm_activity_events`; the manual enroll mutation writes nothing. Add a `campaign_enrolled` event insert (source: `'manual'`) inside `useCampaignEnrollments.ts` after a successful insert. Requires extending the `crm_activity_events_event_type_check` constraint to include `'campaign_enrolled'`. This makes the timeline symmetric and answers "why is this client in this campaign?" from the timeline alone.

## Changes

### Database (migration)

1. `ALTER TABLE public.clients ADD COLUMN last_contact_at TIMESTAMPTZ, ADD COLUMN last_contact_direction TEXT, ADD COLUMN last_contact_channel TEXT;`
2. `CREATE INDEX clients_last_contact_at_idx ON public.clients (tenant_id, last_contact_at DESC NULLS LAST);`
3. Trigger function `sync_client_last_contact()` (SECURITY DEFINER, fixed `search_path`):
   - Fires `AFTER INSERT` on `crm_activity_events` when `NEW.event_type IN ('email_sent','email_received','sms_sent','sms_received')` and `NEW.client_id IS NOT NULL`.
   - Updates `clients` **only if** `NEW.created_at > clients.last_contact_at` (or existing is NULL). Sets direction from the `_sent`/`_received` suffix and channel from the `email_`/`sms_` prefix.
4. Extend `crm_activity_events_event_type_check` to allow `'campaign_enrolled'`.
5. **Backfill** existing rows in a single statement:
   ```sql
   WITH latest AS (
     SELECT DISTINCT ON (client_id)
            client_id, created_at, event_type
     FROM crm_activity_events
     WHERE event_type IN ('email_sent','email_received','sms_sent','sms_received')
       AND client_id IS NOT NULL
     ORDER BY client_id, created_at DESC
   )
   UPDATE public.clients c
   SET last_contact_at = l.created_at,
       last_contact_direction = CASE WHEN l.event_type LIKE '%_received' THEN 'received' ELSE 'sent' END,
       last_contact_channel   = CASE WHEN l.event_type LIKE 'email_%'    THEN 'email'    ELSE 'sms'  END
   FROM latest l WHERE l.client_id = c.id;
   ```

### Frontend

6. **`src/lib/crm/types.ts`** — add the three new fields to `CrmClient`. Add `'campaign_enrolled'` to the event-type union.
7. **`src/hooks/crm/useClients.ts`** and **`src/hooks/crm/useClientQuickProfile.ts`** — include the three new columns in `.select(...)`. `useClients` gets an optional sort key `'last_contact_at'`.
8. **`src/pages/crm/ClientDetail.tsx`** — extend the `.select(...)` to pull the three new fields.
9. **`src/components/crm/detail/ClientInfoCard.tsx`** — render a "Last Contact" row under status/tags: `formatDistanceToNow(last_contact_at) + ' ago · ' + capitalize(channel) + ' ' + direction`. Empty state: "No contact yet."
10. **`src/components/crm/ClientQuickProfile.tsx`** — same "Last Contact" line in the sheet header area.
11. **`src/pages/crm/Clients.tsx`** (table view) — add a sortable "Last Contact" column between "Status" and existing right-side columns, rendering relative time (or muted "Never"). Kanban/grid views unchanged.
12. **`src/hooks/crm/useClientCampaigns.ts`** (new) — `useQuery` reading `crm_campaign_enrollments` for a client, joined to `crm_campaigns(id, name)`, ordered by `enrolled_at DESC`.
13. **`src/components/crm/detail/CampaignHistoryCard.tsx`** (new) — card rendered on the profile below `ClientInfoCard`. One row per enrollment: campaign name (link to `/crm/campaigns/:id`), status badge, enrolled date, and step progress via the existing `renderStepLabel` helper. Empty state: "Never enrolled in a campaign."
14. **`src/pages/crm/ClientDetail.tsx`** — mount `CampaignHistoryCard` in the left column.
15. **`src/hooks/crm/useCampaignEnrollments.ts`** — inside the manual enroll mutation, after the enrollment insert succeeds, batch-insert `campaign_enrolled` activity events (one per client) with metadata `{ source: 'manual', campaign_id, campaign_name, enrolled_by_profile_id }`.

## Out of scope

- No edits to any existing `clients` column (project rule).
- No changes to how the three edge functions write activity events — the new trigger is the sole `last_contact_*` writer.
- No new "last contact" filter on the clients page — the existing "Communication Received" filter already covers the inbound-only case; a broader "any contact" filter can be added later without schema changes now that the column exists.

## Verification

- After migration, `SELECT COUNT(*) FROM clients WHERE last_contact_at IS NOT NULL` matches `SELECT COUNT(DISTINCT client_id) FROM crm_activity_events WHERE event_type IN (…)`.
- Send a reply through the CRM → within one refetch cycle the profile shows "just now · Email sent" and the same client jumps to the top when the table is sorted by Last Contact.
- Receive an inbound SMS webhook → profile flips to "just now · SMS received."
- Manually enroll a client → activity timeline shows a `campaign_enrolled` entry and `CampaignHistoryCard` lists the new active enrollment. Change the client's status to trigger cancellation → the card shows both the cancelled row and any auto-enrolled follow-up.
