
-- Phase 9: Controlled enrollment state actions
-- Adds 5 RPCs that own all enrollment status transitions. Frontend must call these.

CREATE OR REPLACE FUNCTION public._crm_enrollment_tenant_check(
  p_enrollment_id uuid
) RETURNS public.crm_campaign_enrollments
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enrollment public.crm_campaign_enrollments;
  v_ctx jsonb;
  v_tenant_id uuid;
BEGIN
  v_ctx := public.get_crm_operating_context();
  v_tenant_id := NULLIF(v_ctx->>'current_tenant_id','')::uuid;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized: no active tenant context';
  END IF;
  SELECT * INTO v_enrollment FROM public.crm_campaign_enrollments WHERE id = p_enrollment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'enrollment_not_found';
  END IF;
  IF v_enrollment.tenant_id <> v_tenant_id THEN
    RAISE EXCEPTION 'unauthorized: enrollment belongs to a different tenant';
  END IF;
  RETURN v_enrollment;
END;
$$;

REVOKE ALL ON FUNCTION public._crm_enrollment_tenant_check(uuid) FROM PUBLIC;

-- Helper: idempotency check/write
CREATE OR REPLACE FUNCTION public._crm_idempotency_claim(
  p_key text,
  p_operation text,
  p_tenant_id uuid,
  p_target_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing jsonb;
BEGIN
  IF p_key IS NULL OR p_key = '' THEN RETURN NULL; END IF;
  SELECT result_json INTO v_existing
  FROM public.crm_idempotency_keys
  WHERE key = p_key AND operation = p_operation
  LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  INSERT INTO public.crm_idempotency_keys (key, operation, actor_id, tenant_id, target_id, status, expires_at, result_json)
  VALUES (p_key, p_operation, auth.uid(), p_tenant_id, p_target_id, 'in_flight', now() + interval '24 hours', NULL)
  ON CONFLICT (key) DO NOTHING;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public._crm_idempotency_claim(text, text, uuid, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public._crm_idempotency_record(
  p_key text,
  p_operation text,
  p_result jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_key IS NULL OR p_key = '' THEN RETURN; END IF;
  UPDATE public.crm_idempotency_keys
    SET result_json = p_result, status = 'completed', updated_at = now()
    WHERE key = p_key AND operation = p_operation;
END;
$$;

REVOKE ALL ON FUNCTION public._crm_idempotency_record(text, text, jsonb) FROM PUBLIC;

-- PAUSE
CREATE OR REPLACE FUNCTION public.crm_pause_enrollment(
  p_enrollment_id uuid,
  p_reason text,
  p_idempotency_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_e public.crm_campaign_enrollments;
  v_result jsonb;
  v_cached jsonb;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RETURN jsonb_build_object('ok', false, 'error_code','reason_required');
  END IF;
  v_e := public._crm_enrollment_tenant_check(p_enrollment_id);
  v_cached := public._crm_idempotency_claim(p_idempotency_key, 'crm_pause_enrollment', v_e.tenant_id, p_enrollment_id);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  IF v_e.status <> 'active' THEN
    v_result := jsonb_build_object('ok', false, 'error_code','invalid_transition','from', v_e.status,'to','paused');
    PERFORM public._crm_idempotency_record(p_idempotency_key,'crm_pause_enrollment', v_result);
    RETURN v_result;
  END IF;

  UPDATE public.crm_campaign_enrollments
    SET status='paused', paused_at = now(), pause_reason = p_reason, updated_at = now()
    WHERE id = p_enrollment_id;

  -- cascade-suppress future scheduled step logs
  UPDATE public.crm_campaign_step_logs
    SET status='skipped', skip_reason = 'enrollment_paused', updated_at = now()
    WHERE enrollment_id = p_enrollment_id AND status='scheduled' AND scheduled_for > now();

  INSERT INTO public.crm_activity_events (tenant_id, client_id, event_type, old_value, new_value, metadata, created_by_profile_id)
  VALUES (v_e.tenant_id, v_e.client_id, 'campaign_enrollment_paused', 'active','paused',
          jsonb_build_object('enrollment_id', p_enrollment_id, 'campaign_id', v_e.campaign_id, 'reason', p_reason),
          auth.uid());

  v_result := jsonb_build_object('ok', true, 'enrollment_id', p_enrollment_id, 'status','paused');
  PERFORM public._crm_idempotency_record(p_idempotency_key,'crm_pause_enrollment', v_result);
  RETURN v_result;
END;
$$;

-- RESUME
CREATE OR REPLACE FUNCTION public.crm_resume_enrollment(
  p_enrollment_id uuid,
  p_reason text,
  p_idempotency_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_e public.crm_campaign_enrollments;
  v_result jsonb;
  v_cached jsonb;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RETURN jsonb_build_object('ok', false, 'error_code','reason_required');
  END IF;
  v_e := public._crm_enrollment_tenant_check(p_enrollment_id);
  v_cached := public._crm_idempotency_claim(p_idempotency_key, 'crm_resume_enrollment', v_e.tenant_id, p_enrollment_id);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  IF v_e.status <> 'paused' THEN
    v_result := jsonb_build_object('ok', false, 'error_code','invalid_transition','from', v_e.status,'to','active');
    PERFORM public._crm_idempotency_record(p_idempotency_key,'crm_resume_enrollment', v_result);
    RETURN v_result;
  END IF;

  UPDATE public.crm_campaign_enrollments
    SET status='active', paused_at = NULL, pause_reason = NULL, updated_at = now()
    WHERE id = p_enrollment_id;

  -- re-schedule previously suppressed steps: revert only ones we skipped due to pause
  UPDATE public.crm_campaign_step_logs
    SET status='scheduled', skip_reason = NULL, updated_at = now()
    WHERE enrollment_id = p_enrollment_id AND status='skipped'
      AND skip_reason='enrollment_paused' AND scheduled_for > now();

  INSERT INTO public.crm_activity_events (tenant_id, client_id, event_type, old_value, new_value, metadata, created_by_profile_id)
  VALUES (v_e.tenant_id, v_e.client_id, 'campaign_enrollment_resumed','paused','active',
          jsonb_build_object('enrollment_id', p_enrollment_id, 'campaign_id', v_e.campaign_id, 'reason', p_reason),
          auth.uid());

  v_result := jsonb_build_object('ok', true, 'enrollment_id', p_enrollment_id, 'status','active');
  PERFORM public._crm_idempotency_record(p_idempotency_key,'crm_resume_enrollment', v_result);
  RETURN v_result;
END;
$$;

-- CANCEL
CREATE OR REPLACE FUNCTION public.crm_cancel_enrollment(
  p_enrollment_id uuid,
  p_reason text,
  p_idempotency_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_e public.crm_campaign_enrollments;
  v_result jsonb;
  v_cached jsonb;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RETURN jsonb_build_object('ok', false, 'error_code','reason_required');
  END IF;
  v_e := public._crm_enrollment_tenant_check(p_enrollment_id);
  v_cached := public._crm_idempotency_claim(p_idempotency_key, 'crm_cancel_enrollment', v_e.tenant_id, p_enrollment_id);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  IF v_e.status IN ('cancelled','completed') THEN
    v_result := jsonb_build_object('ok', false, 'error_code','invalid_transition','from', v_e.status,'to','cancelled');
    PERFORM public._crm_idempotency_record(p_idempotency_key,'crm_cancel_enrollment', v_result);
    RETURN v_result;
  END IF;

  UPDATE public.crm_campaign_enrollments
    SET status='cancelled', completed_at = now(), pause_reason = COALESCE(pause_reason, p_reason), updated_at = now()
    WHERE id = p_enrollment_id;

  UPDATE public.crm_campaign_step_logs
    SET status='skipped', skip_reason = 'enrollment_cancelled', updated_at = now()
    WHERE enrollment_id = p_enrollment_id AND status='scheduled';

  INSERT INTO public.crm_activity_events (tenant_id, client_id, event_type, old_value, new_value, metadata, created_by_profile_id)
  VALUES (v_e.tenant_id, v_e.client_id, 'campaign_enrollment_cancelled', v_e.status,'cancelled',
          jsonb_build_object('enrollment_id', p_enrollment_id, 'campaign_id', v_e.campaign_id, 'reason', p_reason),
          auth.uid());

  v_result := jsonb_build_object('ok', true, 'enrollment_id', p_enrollment_id, 'status','cancelled');
  PERFORM public._crm_idempotency_record(p_idempotency_key,'crm_cancel_enrollment', v_result);
  RETURN v_result;
END;
$$;

-- MARK RESPONDED
CREATE OR REPLACE FUNCTION public.crm_mark_enrollment_responded(
  p_enrollment_id uuid,
  p_reason text,
  p_idempotency_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_e public.crm_campaign_enrollments;
  v_result jsonb;
  v_cached jsonb;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RETURN jsonb_build_object('ok', false, 'error_code','reason_required');
  END IF;
  v_e := public._crm_enrollment_tenant_check(p_enrollment_id);
  v_cached := public._crm_idempotency_claim(p_idempotency_key, 'crm_mark_enrollment_responded', v_e.tenant_id, p_enrollment_id);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  IF v_e.status NOT IN ('active','paused') THEN
    v_result := jsonb_build_object('ok', false, 'error_code','invalid_transition','from', v_e.status,'to','responded');
    PERFORM public._crm_idempotency_record(p_idempotency_key,'crm_mark_enrollment_responded', v_result);
    RETURN v_result;
  END IF;

  UPDATE public.crm_campaign_enrollments
    SET status='responded', completed_at = now(), updated_at = now()
    WHERE id = p_enrollment_id;

  UPDATE public.crm_campaign_step_logs
    SET status='skipped', skip_reason = 'client_responded', updated_at = now()
    WHERE enrollment_id = p_enrollment_id AND status='scheduled';

  INSERT INTO public.crm_activity_events (tenant_id, client_id, event_type, old_value, new_value, metadata, created_by_profile_id)
  VALUES (v_e.tenant_id, v_e.client_id, 'campaign_enrollment_responded', v_e.status, 'responded',
          jsonb_build_object('enrollment_id', p_enrollment_id, 'campaign_id', v_e.campaign_id, 'reason', p_reason),
          auth.uid());

  v_result := jsonb_build_object('ok', true, 'enrollment_id', p_enrollment_id, 'status','responded');
  PERFORM public._crm_idempotency_record(p_idempotency_key,'crm_mark_enrollment_responded', v_result);
  RETURN v_result;
END;
$$;

-- RESTART (only from cancelled/completed/responded → creates a NEW enrollment)
CREATE OR REPLACE FUNCTION public.crm_restart_enrollment(
  p_enrollment_id uuid,
  p_reason text,
  p_idempotency_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_e public.crm_campaign_enrollments;
  v_result jsonb;
  v_cached jsonb;
  v_active_count int;
  v_new_id uuid;
  v_first_step public.crm_campaign_steps;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RETURN jsonb_build_object('ok', false, 'error_code','reason_required');
  END IF;
  v_e := public._crm_enrollment_tenant_check(p_enrollment_id);
  v_cached := public._crm_idempotency_claim(p_idempotency_key, 'crm_restart_enrollment', v_e.tenant_id, p_enrollment_id);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  IF v_e.status NOT IN ('cancelled','completed','responded') THEN
    v_result := jsonb_build_object('ok', false, 'error_code','invalid_transition','from', v_e.status,'to','restart');
    PERFORM public._crm_idempotency_record(p_idempotency_key,'crm_restart_enrollment', v_result);
    RETURN v_result;
  END IF;

  -- enforce single active campaign per client
  SELECT count(*) INTO v_active_count FROM public.crm_campaign_enrollments
    WHERE client_id = v_e.client_id AND status IN ('active','paused');
  IF v_active_count > 0 THEN
    v_result := jsonb_build_object('ok', false, 'error_code','client_has_active_enrollment');
    PERFORM public._crm_idempotency_record(p_idempotency_key,'crm_restart_enrollment', v_result);
    RETURN v_result;
  END IF;

  INSERT INTO public.crm_campaign_enrollments (campaign_id, tenant_id, client_id, current_step, status, enrolled_at, enrolled_by_profile_id)
  VALUES (v_e.campaign_id, v_e.tenant_id, v_e.client_id, 0, 'active', now(), auth.uid())
  RETURNING id INTO v_new_id;

  SELECT * INTO v_first_step FROM public.crm_campaign_steps
    WHERE campaign_id = v_e.campaign_id AND is_active = true
    ORDER BY step_order ASC LIMIT 1;

  IF FOUND THEN
    INSERT INTO public.crm_campaign_step_logs (enrollment_id, step_id, tenant_id, client_id, scheduled_for, status, channel)
    VALUES (v_new_id, v_first_step.id, v_e.tenant_id, v_e.client_id,
            now() + make_interval(days => COALESCE(v_first_step.delay_days,0), hours => COALESCE(v_first_step.delay_hours,0)),
            'scheduled', v_first_step.channel);
  END IF;

  INSERT INTO public.crm_activity_events (tenant_id, client_id, event_type, old_value, new_value, metadata, created_by_profile_id)
  VALUES (v_e.tenant_id, v_e.client_id, 'campaign_enrollment_restarted', v_e.status, 'active',
          jsonb_build_object('previous_enrollment_id', p_enrollment_id, 'new_enrollment_id', v_new_id, 'campaign_id', v_e.campaign_id, 'reason', p_reason),
          auth.uid());

  v_result := jsonb_build_object('ok', true, 'previous_enrollment_id', p_enrollment_id, 'new_enrollment_id', v_new_id, 'status','active');
  PERFORM public._crm_idempotency_record(p_idempotency_key,'crm_restart_enrollment', v_result);
  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.crm_pause_enrollment(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_resume_enrollment(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_cancel_enrollment(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_mark_enrollment_responded(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_restart_enrollment(uuid,text,text) TO authenticated;
