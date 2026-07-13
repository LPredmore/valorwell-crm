
CREATE OR REPLACE FUNCTION public.assign_client_clinician(
  client_id uuid, tenant_id uuid, staff_id uuid,
  reason text, concurrency_token uuid, contract_version text,
  idempotency_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE caller uuid := auth.uid(); cur_token uuid; cur_val uuid; cached jsonb; r jsonb;
BEGIN
  IF caller IS NULL OR NOT public.crm_has_role(caller, tenant_id) THEN
    RETURN jsonb_build_object('ok', false, 'error_code','unauthorized'); END IF;
  cached := public._crm_idem_check(idempotency_key, caller, 'assign_client_clinician');
  IF cached IS NOT NULL THEN RETURN cached; END IF;
  SELECT COALESCE(m.concurrency_token, md5(c.id::text || COALESCE(c.updated_at::text,''))::uuid),
         c.primary_staff_id
    INTO cur_token, cur_val
    FROM public.clients c LEFT JOIN public.crm_client_canonical_meta m ON m.client_id=c.id
    WHERE c.id=client_id AND c.tenant_id=tenant_id;
  IF cur_token IS NULL THEN RETURN jsonb_build_object('ok', false,'error_code','not_found'); END IF;
  IF cur_token <> concurrency_token THEN RETURN jsonb_build_object('ok', false,'error_code','concurrency_conflict'); END IF;
  UPDATE public.clients SET primary_staff_id = staff_id, updated_at = now() WHERE id = client_id;
  PERFORM public._crm_ensure_meta(client_id, tenant_id);
  INSERT INTO public.crm_client_state_audit
    (tenant_id, client_id, dimension, from_value, to_value, reason, actor_profile_id)
  VALUES
    (tenant_id, client_id, 'lifecycle_stage',
     'clinician:' || COALESCE(cur_val::text,'null'),
     'clinician:' || COALESCE(staff_id::text,'null'),
     reason, caller);
  r := jsonb_build_object('ok', true);
  PERFORM public._crm_idem_store(idempotency_key, caller, 'assign_client_clinician', r);
  RETURN r;
END; $$;

CREATE OR REPLACE FUNCTION public.set_client_risk(
  client_id uuid, tenant_id uuid, at_risk boolean, risk_reason text,
  reason text, concurrency_token uuid, contract_version text,
  idempotency_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE caller uuid := auth.uid(); cur_token uuid; cur_val boolean; cached jsonb; r jsonb;
BEGIN
  IF caller IS NULL OR NOT public.crm_has_role(caller, tenant_id) THEN
    RETURN jsonb_build_object('ok', false, 'error_code','unauthorized'); END IF;
  cached := public._crm_idem_check(idempotency_key, caller, 'set_client_risk');
  IF cached IS NOT NULL THEN RETURN cached; END IF;
  SELECT COALESCE(m.concurrency_token, md5(c.id::text || COALESCE(c.updated_at::text,''))::uuid),
         c.at_risk
    INTO cur_token, cur_val
    FROM public.clients c LEFT JOIN public.crm_client_canonical_meta m ON m.client_id=c.id
    WHERE c.id=client_id AND c.tenant_id=tenant_id;
  IF cur_token IS NULL THEN RETURN jsonb_build_object('ok', false,'error_code','not_found'); END IF;
  IF cur_token <> concurrency_token THEN RETURN jsonb_build_object('ok', false,'error_code','concurrency_conflict'); END IF;
  UPDATE public.clients
     SET at_risk = set_client_risk.at_risk,
         at_risk_since = CASE WHEN set_client_risk.at_risk THEN COALESCE(at_risk_since, now()) ELSE NULL END,
         updated_at = now()
   WHERE id = client_id;
  INSERT INTO public.crm_client_canonical_meta (client_id, tenant_id, concurrency_token, risk_reason, at_risk_marked_at)
  VALUES (client_id, tenant_id, gen_random_uuid(),
          CASE WHEN set_client_risk.at_risk THEN risk_reason ELSE NULL END,
          CASE WHEN set_client_risk.at_risk THEN now() ELSE NULL END)
  ON CONFLICT (client_id) DO UPDATE
    SET concurrency_token = gen_random_uuid(),
        risk_reason = CASE WHEN set_client_risk.at_risk THEN risk_reason ELSE NULL END,
        at_risk_marked_at = CASE WHEN set_client_risk.at_risk THEN now() ELSE NULL END,
        updated_at = now();
  INSERT INTO public.crm_client_state_audit
    (tenant_id, client_id, dimension, from_value, to_value, reason, actor_profile_id)
  VALUES
    (tenant_id, client_id, 'at_risk', cur_val::text, set_client_risk.at_risk::text,
     COALESCE(reason, risk_reason), caller);
  r := jsonb_build_object('ok', true);
  PERFORM public._crm_idem_store(idempotency_key, caller, 'set_client_risk', r);
  RETURN r;
END; $$;

GRANT EXECUTE ON FUNCTION public.assign_client_clinician(uuid,uuid,uuid,text,uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_client_risk(uuid,uuid,boolean,text,text,uuid,text,text) TO authenticated;
