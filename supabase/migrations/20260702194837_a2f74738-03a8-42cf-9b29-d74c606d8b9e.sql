-- 1. Add columns (additive)
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS last_contact_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_contact_direction TEXT,
  ADD COLUMN IF NOT EXISTS last_contact_channel TEXT;

CREATE INDEX IF NOT EXISTS clients_last_contact_at_idx
  ON public.clients (tenant_id, last_contact_at DESC NULLS LAST);

-- 2. Trigger function to sync last_contact_* from activity events
CREATE OR REPLACE FUNCTION public.sync_client_last_contact()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_direction TEXT;
  v_channel TEXT;
BEGIN
  IF NEW.client_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.event_type NOT IN ('email_sent','email_received','sms_sent','sms_received') THEN
    RETURN NEW;
  END IF;

  v_direction := CASE WHEN NEW.event_type LIKE '%_received' THEN 'received' ELSE 'sent' END;
  v_channel   := CASE WHEN NEW.event_type LIKE 'email_%'    THEN 'email'    ELSE 'sms'  END;

  UPDATE public.clients
     SET last_contact_at        = NEW.created_at,
         last_contact_direction = v_direction,
         last_contact_channel   = v_channel
   WHERE id = NEW.client_id
     AND (last_contact_at IS NULL OR NEW.created_at > last_contact_at);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_client_last_contact ON public.crm_activity_events;
CREATE TRIGGER trg_sync_client_last_contact
AFTER INSERT ON public.crm_activity_events
FOR EACH ROW
EXECUTE FUNCTION public.sync_client_last_contact();

-- 3. Backfill from existing events
WITH latest AS (
  SELECT DISTINCT ON (client_id)
         client_id, created_at, event_type
  FROM public.crm_activity_events
  WHERE event_type IN ('email_sent','email_received','sms_sent','sms_received')
    AND client_id IS NOT NULL
  ORDER BY client_id, created_at DESC
)
UPDATE public.clients c
SET last_contact_at        = l.created_at,
    last_contact_direction = CASE WHEN l.event_type LIKE '%_received' THEN 'received' ELSE 'sent' END,
    last_contact_channel   = CASE WHEN l.event_type LIKE 'email_%'    THEN 'email'    ELSE 'sms'  END
FROM latest l
WHERE l.client_id = c.id;

-- 4. Extend event_type check constraint to include campaign_enrolled
DO $$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
  FROM pg_constraint
  WHERE conname = 'crm_activity_events_event_type_check'
    AND conrelid = 'public.crm_activity_events'::regclass;

  IF v_def IS NOT NULL AND position('campaign_enrolled' in v_def) = 0 THEN
    ALTER TABLE public.crm_activity_events
      DROP CONSTRAINT crm_activity_events_event_type_check;

    ALTER TABLE public.crm_activity_events
      ADD CONSTRAINT crm_activity_events_event_type_check
      CHECK (event_type IN (
        'note_added',
        'status_change',
        'email_sent',
        'email_received',
        'sms_sent',
        'sms_received',
        'campaign_started',
        'campaign_completed',
        'campaign_auto_cancelled',
        'campaign_auto_enrolled',
        'campaign_enrolled'
      ));
  END IF;
END $$;