CREATE OR REPLACE FUNCTION public.crm_set_at_risk(
  p_client_id uuid,
  p_at_risk boolean,
  p_reason text,
  p_concurrency_token text DEFAULT 'auto',
  p_idempotency_key uuid DEFAULT NULL,
  p_contract_version text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _actor uuid := auth.uid();
  _cached jsonb;
  _row RECORD;
  _tenant uuid;
  _cur boolean;
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'invalid_reason');
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    _cached := public._crm_idem_check(p_idempotency_key::text, _actor, 'crm_set_at_risk');
    IF _cached IS NOT NULL THEN RETURN _cached; END IF;
  END IF;

  BEGIN
    SELECT * INTO _row FROM public._crm_authorize_client_write(p_client_id, p_concurrency_token);
  EXCEPTION
    WHEN sqlstate '42501' THEN RETURN jsonb_build_object('ok', false, 'error_code', 'unauthorized');
    WHEN sqlstate '40001' THEN RETURN jsonb_build_object('ok', false, 'error_code', 'concurrency_conflict');
  END;

  _tenant := _row.tenant_id;

  SELECT COALESCE(at_risk, false) INTO _cur FROM public.clients WHERE id = p_client_id;

  IF _cur IS DISTINCT FROM p_at_risk THEN
    UPDATE public.clients
       SET at_risk = p_at_risk,
           at_risk_since = CASE WHEN p_at_risk THEN COALESCE(at_risk_since, now()) ELSE NULL END,
           updated_at = now()
     WHERE id = p_client_id;

    PERFORM public._crm_emit_state_change(
      _tenant, p_client_id, 'at_risk'::public.client_state_dimension_enum,
      _cur::text, p_at_risk::text, p_reason, NULL, _actor, p_idempotency_key,
      CASE WHEN p_at_risk THEN 'client_became_at_risk' ELSE 'client_cleared_at_risk' END
    );
    PERFORM public._crm_bump_token(p_client_id, _tenant);
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    PERFORM public._crm_idem_store(p_idempotency_key::text, _actor, 'crm_set_at_risk', jsonb_build_object('ok', true));
  END IF;

  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.crm_set_at_risk(uuid, boolean, text, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_set_at_risk(uuid, boolean, text, text, uuid, text) TO authenticated, service_role;