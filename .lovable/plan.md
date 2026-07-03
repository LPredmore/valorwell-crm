
# ClickUp One-Way Sync (v1)

## Technical decision

**Postgres triggers → `pg_net.http_post` → `clickup-sync` edge function → ClickUp API, with `clients.clickup_task_id` as the idempotency key.** This is the only architecture that meets every stated requirement without leaking the API token to the browser, without polling, and without risking two-way writes. The scheduler already uses `pg_net` + `CRON_SECRET`, so we reuse that exact pattern.

## Scope

- **In:** first_name, last_name, email, phone, status, state, assigned_therapist_id, campaign enrollments (names + last enrolled timestamp).
- **Out:** clinical notes, diagnoses, insurance, session notes, claims, Nexus content, any PHI beyond the fields above.
- **Direction:** Supabase → ClickUp only. No webhook receiver. No writeback path exists.

## Database migration (additive only)

```sql
ALTER TABLE public.clients
  ADD COLUMN clickup_task_id text,
  ADD COLUMN clickup_synced_at timestamptz;

-- Cache of ClickUp custom-field IDs so we don't refetch on every call.
CREATE TABLE public.crm_clickup_field_map (
  field_name text PRIMARY KEY,
  field_id   text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.crm_clickup_field_map TO authenticated;
GRANT ALL   ON public.crm_clickup_field_map TO service_role;
ALTER TABLE public.crm_clickup_field_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role manages field map"
  ON public.crm_clickup_field_map FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Extend activity enum
ALTER TABLE public.crm_activity_events
  DROP CONSTRAINT crm_activity_events_event_type_check;
ALTER TABLE public.crm_activity_events
  ADD CONSTRAINT crm_activity_events_event_type_check
  CHECK (event_type IN (
    'status_change','note_added','email_sent','email_received',
    'conversation_linked','bulk_send','campaign_auto_cancelled',
    'sms_sent','sms_received','campaign_auto_enrolled',
    'campaign_enrolled','client_synced_to_clickup'
  ));

-- Trigger function: enqueue sync via pg_net
CREATE OR REPLACE FUNCTION public.trg_enqueue_clickup_sync(p_client_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_url text := 'https://ahqauomkgflopxgnlndd.supabase.co/functions/v1/clickup-sync';
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1;
  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-cron-secret', v_secret
    ),
    body := jsonb_build_object('client_id', p_client_id, 'action','upsert')
  );
END $$;

-- Fires only when a synced field actually changed
CREATE OR REPLACE FUNCTION public.trg_clients_clickup_sync()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.pat_name_f IS DISTINCT FROM OLD.pat_name_f
     OR NEW.pat_name_l IS DISTINCT FROM OLD.pat_name_l
     OR NEW.email      IS DISTINCT FROM OLD.email
     OR NEW.phone      IS DISTINCT FROM OLD.phone
     OR NEW.pat_status IS DISTINCT FROM OLD.pat_status
     OR NEW.pat_state  IS DISTINCT FROM OLD.pat_state
     OR NEW.primary_staff_id IS DISTINCT FROM OLD.primary_staff_id
  THEN
    PERFORM public.trg_enqueue_clickup_sync(NEW.id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_clients_clickup_sync
AFTER INSERT OR UPDATE ON public.clients
FOR EACH ROW EXECUTE FUNCTION public.trg_clients_clickup_sync();

-- Campaign enrollment changes → sync affected client
CREATE OR REPLACE FUNCTION public.trg_enrollment_clickup_sync()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.trg_enqueue_clickup_sync(COALESCE(NEW.client_id, OLD.client_id));
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER trg_enrollment_clickup_sync
AFTER INSERT OR UPDATE OR DELETE ON public.crm_campaign_enrollments
FOR EACH ROW EXECUTE FUNCTION public.trg_enrollment_clickup_sync();
```

## Edge function: `supabase/functions/clickup-sync/index.ts`

- Auth: requires `x-cron-secret` header equal to `CRON_SECRET`. No public path.
- Inputs: `{ client_id, action: 'upsert' | 'delete' }` or `{ action: 'backfill', tenant_id }`.
- Reads with service role:
  - client core fields + primary_staff name
  - all rows in `crm_campaign_enrollments` for that client, joined to `crm_campaigns` for names, ordered by `created_at` desc
- **Field bootstrap:** on cold start, GET `/list/{list_id}/field`, upsert IDs into `crm_clickup_field_map` for the 10 mapped fields. If a field name is missing in ClickUp, log a clear error naming the field so you can add it in ClickUp — the function does not attempt to create List custom fields.
- Task name: `"{pat_name_f} {pat_name_l}"` (falls back to preferred name).
- Mapped custom fields (10):
  1. Supabase Client ID (short text)
  2. Email (email)
  3. Phone (phone)
  4. Client Status - EHR (dropdown; label match)
  5. State (short text)
  6. Assigned Therapist (short text)
  7. Campaigns (short text, comma-joined names)
  8. Last Campaign At (date, ms since epoch)
  9. Last Synced At (date, ms since epoch)
  10. Sync Source (short text, constant `"Supabase EHR"`)
- Idempotency:
  - `clickup_task_id IS NULL` → `POST /list/{list_id}/task`, store returned id.
  - non-null → `PUT /task/{task_id}`, then `POST /task/{task_id}/field/{field_id}` per custom field.
  - Any ClickUp 404 on update → `UPDATE clients SET clickup_task_id = NULL`, then create.
- On success: `UPDATE clients SET clickup_synced_at = now()` and insert `crm_activity_events(event_type='client_synced_to_clickup')`.
- Errors are logged but do not throw back to the trigger (fire-and-forget via `pg_net`).

## Secrets

- `CLICKUP_API_TOKEN` — requested via `add_secret` after plan approval (ClickUp → Settings → Apps → Generate).
- `CLICKUP_LIST_ID` — set to `901327741230` via `set_secret`.
- `CRON_SECRET` — already configured; reused.

## Frontend (minimal)

- **Settings page:** add `ClickUpConfigPanel` — shows token status, the target List ID (read-only), a "Sync all clients" button that calls `clickup-sync` with `{action:'backfill'}`, and lists any custom fields missing from ClickUp (from the last bootstrap attempt).
- **ClientInfoCard:** add a small "Synced to ClickUp {relativeTime}" line when `clickup_synced_at` is set, and a "Re-sync" button that invokes the function for this client.

## Explicit non-goals for v1

- No ClickUp → Supabase webhook. Edits made in ClickUp are discarded on the next sync.
- No per-tenant List routing. Every client goes to List `901327741230`.
- No retry queue beyond `pg_net`'s single attempt; the "Re-sync" button and "Sync all" backfill cover recovery.

## Prerequisite you must confirm before build

The 10 custom fields listed above must exist on ClickUp List `901327741230` with exactly those names. If any are missing, add them in ClickUp first (or tell me to rename to match what already exists) — the function will refuse to guess field mappings.
