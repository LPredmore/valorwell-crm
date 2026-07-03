
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS clickup_task_id text,
  ADD COLUMN IF NOT EXISTS clickup_synced_at timestamptz;

CREATE TABLE IF NOT EXISTS public.crm_clickup_field_map (
  field_name text PRIMARY KEY,
  field_id   text NOT NULL,
  field_type text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.crm_clickup_field_map TO authenticated;
GRANT ALL ON public.crm_clickup_field_map TO service_role;
ALTER TABLE public.crm_clickup_field_map ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role manages field map" ON public.crm_clickup_field_map;
CREATE POLICY "service role manages field map"
  ON public.crm_clickup_field_map FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
DROP POLICY IF EXISTS "authenticated can view field map" ON public.crm_clickup_field_map;
CREATE POLICY "authenticated can view field map"
  ON public.crm_clickup_field_map FOR SELECT
  TO authenticated USING (true);

-- Extend activity event type constraint
ALTER TABLE public.crm_activity_events
  DROP CONSTRAINT IF EXISTS crm_activity_events_event_type_check;
ALTER TABLE public.crm_activity_events
  ADD CONSTRAINT crm_activity_events_event_type_check
  CHECK (event_type IN (
    'status_change','note_added','email_sent','email_received',
    'conversation_linked','bulk_send','campaign_auto_cancelled',
    'sms_sent','sms_received','campaign_auto_enrolled',
    'campaign_enrolled','client_synced_to_clickup'
  ));

-- Enqueue helper
CREATE OR REPLACE FUNCTION public.trg_enqueue_clickup_sync(p_client_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_url text := 'https://ahqauomkgflopxgnlndd.supabase.co/functions/v1/clickup-sync';
  v_secret text;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_secret
      FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_secret := NULL;
  END;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-cron-secret', COALESCE(v_secret, '')
    ),
    body := jsonb_build_object('client_id', p_client_id, 'action', 'upsert')
  );
EXCEPTION WHEN OTHERS THEN
  -- Never break the parent transaction on sync-enqueue failure
  NULL;
END $$;

-- Clients trigger: only when a synced field actually changed
CREATE OR REPLACE FUNCTION public.trg_clients_clickup_sync()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.pat_name_f       IS DISTINCT FROM OLD.pat_name_f
     OR NEW.pat_name_l       IS DISTINCT FROM OLD.pat_name_l
     OR NEW.email            IS DISTINCT FROM OLD.email
     OR NEW.phone            IS DISTINCT FROM OLD.phone
     OR NEW.pat_status       IS DISTINCT FROM OLD.pat_status
     OR NEW.pat_state        IS DISTINCT FROM OLD.pat_state
     OR NEW.primary_staff_id IS DISTINCT FROM OLD.primary_staff_id
  THEN
    PERFORM public.trg_enqueue_clickup_sync(NEW.id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_clients_clickup_sync ON public.clients;
CREATE TRIGGER trg_clients_clickup_sync
AFTER INSERT OR UPDATE ON public.clients
FOR EACH ROW EXECUTE FUNCTION public.trg_clients_clickup_sync();

-- Enrollment trigger
CREATE OR REPLACE FUNCTION public.trg_enrollment_clickup_sync()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.trg_enqueue_clickup_sync(COALESCE(NEW.client_id, OLD.client_id));
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_enrollment_clickup_sync ON public.crm_campaign_enrollments;
CREATE TRIGGER trg_enrollment_clickup_sync
AFTER INSERT OR UPDATE OR DELETE ON public.crm_campaign_enrollments
FOR EACH ROW EXECUTE FUNCTION public.trg_enrollment_clickup_sync();
