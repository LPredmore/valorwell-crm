
-- 1) Additive columns
ALTER TABLE public.crm_campaign_triggers
  ADD COLUMN IF NOT EXISTS trigger_dimension text,
  ADD COLUMN IF NOT EXISTS trigger_operator text NOT NULL DEFAULT 'equals',
  ADD COLUMN IF NOT EXISTS trigger_value text,
  ADD COLUMN IF NOT EXISTS trigger_event text,
  ADD COLUMN IF NOT EXISTS trigger_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_manual_only boolean NOT NULL DEFAULT false;

-- 2) Retire legacy pat_status function (rename to preserve history)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname='enroll_campaign_on_status_change' AND pronamespace='public'::regnamespace) THEN
    ALTER FUNCTION public.enroll_campaign_on_status_change() RENAME TO _legacy_enroll_campaign_on_status_change;
  END IF;
END $$;

-- 3) Backfill canonical dimensions on existing triggers
UPDATE public.crm_campaign_triggers
SET trigger_dimension = 'lifecycle',
    trigger_operator = 'equals',
    trigger_value = trigger_on_status,
    trigger_event = 'lifecycle_changed'
WHERE trigger_dimension IS NULL
  AND trigger_on_status IN ('Registered','Matching','Waitlist');

UPDATE public.crm_campaign_triggers
SET is_manual_only = true,
    trigger_dimension = COALESCE(trigger_dimension, 'manual'),
    trigger_value = COALESCE(trigger_value, trigger_on_status),
    trigger_event = COALESCE(trigger_event, 'manual')
WHERE trigger_dimension IS NULL OR trigger_dimension = 'manual';

-- 4) Canonical trigger processor
CREATE OR REPLACE FUNCTION public.crm_process_canonical_campaign_triggers()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_trigger RECORD;
  v_campaign RECORD;
  v_existing UUID;
  v_enrollment_id UUID;
  v_first_step RECORD;
  v_scheduled TIMESTAMPTZ;
BEGIN
  IF NEW.to_value IS NULL THEN
    RETURN NEW;
  END IF;

  FOR v_trigger IN
    SELECT ct.*
    FROM public.crm_campaign_triggers ct
    WHERE ct.tenant_id = NEW.tenant_id
      AND ct.is_active = true
      AND ct.is_manual_only = false
      AND ct.trigger_dimension = NEW.dimension
      AND (
        (ct.trigger_operator = 'equals' AND ct.trigger_value = NEW.to_value)
        OR (ct.trigger_operator = 'not_equals' AND ct.trigger_value <> NEW.to_value)
        OR (ct.trigger_operator = 'any')
      )
  LOOP
    SELECT id, is_active INTO v_campaign
    FROM public.crm_campaigns
    WHERE id = v_trigger.campaign_id;

    IF v_campaign.id IS NULL OR v_campaign.is_active = false THEN
      CONTINUE;
    END IF;

    -- Idempotency: no duplicate active enrollment for the same client+campaign
    SELECT id INTO v_existing
    FROM public.crm_campaign_enrollments
    WHERE client_id = NEW.client_id
      AND campaign_id = v_trigger.campaign_id
      AND status IN ('active','paused')
    LIMIT 1;

    IF v_existing IS NOT NULL THEN
      CONTINUE;
    END IF;

    -- One active campaign per client, globally
    SELECT id INTO v_existing
    FROM public.crm_campaign_enrollments
    WHERE client_id = NEW.client_id AND status = 'active'
    LIMIT 1;

    IF v_existing IS NOT NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO public.crm_campaign_enrollments
      (campaign_id, client_id, tenant_id, current_step, status, enrolled_at)
    VALUES
      (v_trigger.campaign_id, NEW.client_id, NEW.tenant_id, 0, 'active', now())
    RETURNING id INTO v_enrollment_id;

    SELECT id, delay_days, delay_hours, channel INTO v_first_step
    FROM public.crm_campaign_steps
    WHERE campaign_id = v_trigger.campaign_id AND is_active = true
    ORDER BY step_order LIMIT 1;

    IF v_first_step.id IS NOT NULL THEN
      v_scheduled := now()
        + (COALESCE(v_first_step.delay_days,0) || ' days')::interval
        + (COALESCE(v_first_step.delay_hours,0) || ' hours')::interval;

      INSERT INTO public.crm_campaign_step_logs
        (enrollment_id, step_id, tenant_id, client_id, scheduled_for, status, channel)
      VALUES
        (v_enrollment_id, v_first_step.id, NEW.tenant_id, NEW.client_id, v_scheduled, 'scheduled', v_first_step.channel);
    END IF;

    INSERT INTO public.crm_activity_events
      (tenant_id, client_id, event_type, new_value, metadata, created_by_profile_id)
    VALUES
      (NEW.tenant_id, NEW.client_id, 'campaign_auto_enrolled', v_trigger.campaign_id::text,
       jsonb_build_object(
         'triggered_by', 'canonical_state_audit',
         'dimension', NEW.dimension,
         'from_value', NEW.from_value,
         'to_value', NEW.to_value,
         'campaign_id', v_trigger.campaign_id,
         'enrollment_id', v_enrollment_id,
         'trigger_id', v_trigger.id,
         'trigger_version', v_trigger.trigger_version,
         'audit_correlation_id', NEW.correlation_id
       ),
       NEW.actor_profile_id);
  END LOOP;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_crm_process_canonical_campaign_triggers ON public.crm_client_state_audit;
CREATE TRIGGER trg_crm_process_canonical_campaign_triggers
AFTER INSERT ON public.crm_client_state_audit
FOR EACH ROW EXECUTE FUNCTION public.crm_process_canonical_campaign_triggers();
