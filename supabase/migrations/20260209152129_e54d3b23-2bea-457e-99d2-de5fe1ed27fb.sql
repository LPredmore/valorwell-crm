
-- Function: cancel active campaign enrollment when client status changes
CREATE OR REPLACE FUNCTION public.cancel_campaign_on_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_enrollment RECORD;
BEGIN
  -- No-op if status didn't actually change
  IF OLD.pat_status IS NOT DISTINCT FROM NEW.pat_status THEN
    RETURN NEW;
  END IF;

  -- Find active enrollment for this client
  SELECT id, tenant_id, campaign_id
  INTO v_enrollment
  FROM crm_campaign_enrollments
  WHERE client_id = NEW.id
    AND status = 'active'
  LIMIT 1;

  -- No active enrollment, nothing to do
  IF v_enrollment.id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Mark enrollment as responded
  UPDATE crm_campaign_enrollments
  SET status = 'responded',
      completed_at = NOW()
  WHERE id = v_enrollment.id;

  -- Skip all pending scheduled steps
  UPDATE crm_campaign_step_logs
  SET status = 'skipped',
      skip_reason = 'client_status_changed'
  WHERE enrollment_id = v_enrollment.id
    AND status = 'scheduled';

  -- Audit trail
  INSERT INTO crm_activity_events (tenant_id, client_id, event_type, metadata)
  VALUES (
    v_enrollment.tenant_id,
    NEW.id,
    'campaign_auto_cancelled',
    jsonb_build_object(
      'triggered_by', 'status_change_campaign_cancel',
      'old_status', OLD.pat_status,
      'new_status', NEW.pat_status,
      'campaign_id', v_enrollment.campaign_id,
      'enrollment_id', v_enrollment.id
    )
  );

  RETURN NEW;
END;
$$;

-- Trigger: fires after any update to clients where pat_status changed
CREATE TRIGGER trg_cancel_campaign_on_status_change
  AFTER UPDATE ON clients
  FOR EACH ROW
  WHEN (OLD.pat_status IS DISTINCT FROM NEW.pat_status)
  EXECUTE FUNCTION cancel_campaign_on_status_change();
