
-- 1. Create the crm_campaign_triggers table
CREATE TABLE public.crm_campaign_triggers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.crm_campaigns(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  trigger_on_status TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, trigger_on_status)
);

-- 2. Enable RLS
ALTER TABLE public.crm_campaign_triggers ENABLE ROW LEVEL SECURITY;

-- 3. RLS policy for tenant isolation
CREATE POLICY "Tenant isolation for crm_campaign_triggers"
  ON public.crm_campaign_triggers
  FOR ALL
  TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_memberships WHERE profile_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_memberships WHERE profile_id = auth.uid()));

-- 4. Auto-enroll trigger function
CREATE OR REPLACE FUNCTION public.enroll_campaign_on_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_trigger RECORD;
  v_campaign RECORD;
  v_existing_active UUID;
  v_enrollment_id UUID;
  v_first_step RECORD;
  v_scheduled_for TIMESTAMPTZ;
BEGIN
  -- No-op if status didn't change
  IF OLD.pat_status IS NOT DISTINCT FROM NEW.pat_status THEN
    RETURN NEW;
  END IF;

  -- Find active trigger for this status + tenant
  SELECT ct.campaign_id
  INTO v_trigger
  FROM crm_campaign_triggers ct
  WHERE ct.tenant_id = NEW.tenant_id
    AND ct.trigger_on_status = NEW.pat_status
    AND ct.is_active = true;

  IF v_trigger.campaign_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Verify campaign is active
  SELECT id, name INTO v_campaign
  FROM crm_campaigns
  WHERE id = v_trigger.campaign_id AND is_active = true;

  IF v_campaign.id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Check no active enrollment exists (belt + suspenders)
  SELECT id INTO v_existing_active
  FROM crm_campaign_enrollments
  WHERE client_id = NEW.id AND status = 'active'
  LIMIT 1;

  IF v_existing_active IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Create enrollment
  INSERT INTO crm_campaign_enrollments (campaign_id, client_id, tenant_id, current_step, status, enrolled_at)
  VALUES (v_trigger.campaign_id, NEW.id, NEW.tenant_id, 1, 'active', NOW())
  RETURNING id INTO v_enrollment_id;

  -- Schedule first step
  SELECT id, delay_days, delay_hours, channel INTO v_first_step
  FROM crm_campaign_steps
  WHERE campaign_id = v_trigger.campaign_id AND is_active = true
  ORDER BY step_order LIMIT 1;

  IF v_first_step.id IS NOT NULL THEN
    v_scheduled_for := NOW() + (COALESCE(v_first_step.delay_days, 0) || ' days')::INTERVAL
                              + (COALESCE(v_first_step.delay_hours, 0) || ' hours')::INTERVAL;

    INSERT INTO crm_campaign_step_logs (enrollment_id, step_id, tenant_id, client_id, scheduled_for, status, channel)
    VALUES (v_enrollment_id, v_first_step.id, NEW.tenant_id, NEW.id, v_scheduled_for, 'scheduled', v_first_step.channel);
  END IF;

  -- Audit trail
  INSERT INTO crm_activity_events (tenant_id, client_id, event_type, metadata)
  VALUES (
    NEW.tenant_id,
    NEW.id,
    'campaign_auto_enrolled',
    jsonb_build_object(
      'triggered_by', 'status_change_auto_enroll',
      'old_status', OLD.pat_status,
      'new_status', NEW.pat_status,
      'campaign_id', v_trigger.campaign_id,
      'enrollment_id', v_enrollment_id
    )
  );

  RETURN NEW;
END;
$$;

-- 5. Create the trigger (fires after cancel trigger due to alphabetical ordering)
CREATE TRIGGER trg_enroll_campaign_on_status_change
  AFTER UPDATE ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.enroll_campaign_on_status_change();
