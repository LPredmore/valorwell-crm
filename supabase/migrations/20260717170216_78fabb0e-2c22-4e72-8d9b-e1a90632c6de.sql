
CREATE OR REPLACE FUNCTION public.crm_enroll_clients_in_campaign(
  p_campaign_id uuid,
  p_client_ids uuid[],
  p_reason text,
  p_idempotency_key uuid,
  p_contract_version text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_campaign RECORD;
  v_first_step RECORD;
  v_actor uuid := auth.uid();
  v_client_id uuid;
  v_client RECORD;
  v_existing uuid;
  v_enrollment_id uuid;
  v_scheduled timestamptz;
  v_policy jsonb;
  v_first_channel text;
  v_message_class text;
  v_results jsonb := '[]'::jsonb;
  v_cached jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Idempotency cache check
  SELECT response_payload INTO v_cached
  FROM public.crm_idempotency_keys
  WHERE key = p_idempotency_key AND operation = 'crm_enroll_clients_in_campaign'
  LIMIT 1;
  IF v_cached IS NOT NULL THEN
    RETURN v_cached;
  END IF;

  SELECT id, tenant_id, is_active INTO v_campaign
  FROM public.crm_campaigns WHERE id = p_campaign_id;

  IF v_campaign.id IS NULL THEN
    RAISE EXCEPTION 'campaign_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Tenant membership check
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_memberships
    WHERE user_id = v_actor AND tenant_id = v_campaign.tenant_id
  ) THEN
    RAISE EXCEPTION 'unauthorized_tenant' USING ERRCODE = '42501';
  END IF;

  SELECT id, delay_days, delay_hours, channel INTO v_first_step
  FROM public.crm_campaign_steps
  WHERE campaign_id = p_campaign_id AND is_active = true
  ORDER BY step_order LIMIT 1;

  v_first_channel := COALESCE(v_first_step.channel, 'email');
  v_message_class := 'ordinary_campaign_follow_up';

  FOREACH v_client_id IN ARRAY p_client_ids LOOP
    SELECT id, tenant_id INTO v_client
    FROM public.clients WHERE id = v_client_id;

    IF v_client.id IS NULL OR v_client.tenant_id <> v_campaign.tenant_id THEN
      v_results := v_results || jsonb_build_object(
        'client_id', v_client_id, 'status', 'skipped', 'reason', 'client_not_in_tenant');
      CONTINUE;
    END IF;

    IF v_campaign.is_active = false THEN
      v_results := v_results || jsonb_build_object(
        'client_id', v_client_id, 'status', 'skipped', 'reason', 'campaign_inactive');
      CONTINUE;
    END IF;

    -- Duplicate active/paused
    SELECT id INTO v_existing
    FROM public.crm_campaign_enrollments
    WHERE client_id = v_client_id
      AND campaign_id = p_campaign_id
      AND status IN ('active','paused')
    LIMIT 1;
    IF v_existing IS NOT NULL THEN
      v_results := v_results || jsonb_build_object(
        'client_id', v_client_id, 'status', 'skipped', 'reason', 'already_enrolled',
        'enrollment_id', v_existing);
      CONTINUE;
    END IF;

    -- One active campaign globally per client
    SELECT id INTO v_existing
    FROM public.crm_campaign_enrollments
    WHERE client_id = v_client_id AND status = 'active' LIMIT 1;
    IF v_existing IS NOT NULL THEN
      v_results := v_results || jsonb_build_object(
        'client_id', v_client_id, 'status', 'skipped', 'reason', 'has_other_active_campaign',
        'enrollment_id', v_existing);
      CONTINUE;
    END IF;

    -- Policy check
    v_policy := public.crm_evaluate_communication_policy(v_client_id, v_first_channel, v_message_class);
    IF COALESCE((v_policy->>'allowed')::boolean, false) = false THEN
      v_results := v_results || jsonb_build_object(
        'client_id', v_client_id, 'status', 'suppressed',
        'reason', COALESCE(v_policy->>'reason_code', 'policy_denied'));
      CONTINUE;
    END IF;

    INSERT INTO public.crm_campaign_enrollments
      (campaign_id, client_id, tenant_id, current_step, status, enrolled_at, enrolled_by_profile_id)
    VALUES
      (p_campaign_id, v_client_id, v_campaign.tenant_id, 0, 'active', now(), v_actor)
    RETURNING id INTO v_enrollment_id;

    IF v_first_step.id IS NOT NULL THEN
      v_scheduled := now()
        + (COALESCE(v_first_step.delay_days,0) || ' days')::interval
        + (COALESCE(v_first_step.delay_hours,0) || ' hours')::interval;
      INSERT INTO public.crm_campaign_step_logs
        (enrollment_id, step_id, tenant_id, client_id, scheduled_for, status, channel)
      VALUES
        (v_enrollment_id, v_first_step.id, v_campaign.tenant_id, v_client_id, v_scheduled, 'scheduled', v_first_step.channel);
    END IF;

    INSERT INTO public.crm_activity_events
      (tenant_id, client_id, event_type, new_value, metadata, created_by_profile_id)
    VALUES
      (v_campaign.tenant_id, v_client_id, 'campaign_enrolled', p_campaign_id::text,
       jsonb_build_object(
         'campaign_id', p_campaign_id,
         'enrollment_id', v_enrollment_id,
         'reason', p_reason,
         'idempotency_key', p_idempotency_key,
         'contract_version', p_contract_version,
         'source', 'manual'
       ),
       v_actor);

    v_results := v_results || jsonb_build_object(
      'client_id', v_client_id, 'status', 'enrolled', 'enrollment_id', v_enrollment_id);
  END LOOP;

  INSERT INTO public.crm_idempotency_keys (key, operation, response_payload, created_at)
  VALUES (p_idempotency_key, 'crm_enroll_clients_in_campaign', v_results, now())
  ON CONFLICT (key) DO NOTHING;

  RETURN v_results;
END;
$fn$;

REVOKE ALL ON FUNCTION public.crm_enroll_clients_in_campaign(uuid, uuid[], text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_enroll_clients_in_campaign(uuid, uuid[], text, uuid, text) TO authenticated, service_role;
