
CREATE OR REPLACE FUNCTION public.crm_has_role(_user_id uuid, _tenant_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.tenant_memberships tm ON tm.profile_id = ur.user_id
    WHERE ur.user_id = _user_id
      AND tm.tenant_id = _tenant_id
      AND ur.role IN ('admin','staff')
  );
$$;

CREATE TABLE IF NOT EXISTS public.crm_client_canonical_meta (
  client_id uuid PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  concurrency_token uuid NOT NULL DEFAULT gen_random_uuid(),
  risk_reason text,
  at_risk_marked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.crm_client_canonical_meta TO authenticated;
GRANT ALL ON public.crm_client_canonical_meta TO service_role;
ALTER TABLE public.crm_client_canonical_meta ENABLE ROW LEVEL SECURITY;
CREATE POLICY "meta readable by tenant admin/staff" ON public.crm_client_canonical_meta
  FOR SELECT TO authenticated USING (public.crm_has_role(auth.uid(), tenant_id));

CREATE TABLE IF NOT EXISTS public.crm_client_state_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  dimension public.client_state_dimension_enum NOT NULL,
  from_value text,
  to_value text,
  reason text,
  disposition_reason text,
  actor_profile_id uuid,
  actor_label text,
  source text NOT NULL DEFAULT 'crm_app',
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_client_state_audit_client
  ON public.crm_client_state_audit(client_id, created_at DESC);
GRANT SELECT ON public.crm_client_state_audit TO authenticated;
GRANT ALL ON public.crm_client_state_audit TO service_role;
ALTER TABLE public.crm_client_state_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit readable by tenant admin/staff" ON public.crm_client_state_audit
  FOR SELECT TO authenticated USING (public.crm_has_role(auth.uid(), tenant_id));

CREATE TABLE IF NOT EXISTS public.crm_idempotency_keys (
  key text PRIMARY KEY,
  actor_id uuid,
  operation text NOT NULL,
  result_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours'
);
CREATE INDEX IF NOT EXISTS idx_crm_idempotency_expires ON public.crm_idempotency_keys(expires_at);
GRANT SELECT ON public.crm_idempotency_keys TO authenticated;
GRANT ALL ON public.crm_idempotency_keys TO service_role;
ALTER TABLE public.crm_idempotency_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "idempotency readable by actor" ON public.crm_idempotency_keys
  FOR SELECT TO authenticated USING (actor_id = auth.uid());

CREATE OR REPLACE VIEW public.v_client_canonical_state AS
SELECT
  c.id AS client_id, c.tenant_id,
  c.lifecycle_stage, c.lifecycle_stage_changed_at,
  c.engagement_state, c.engagement_state_changed_at,
  c.eligibility_state, c.eligibility_state_changed_at,
  c.contact_policy, c.contact_policy_changed_at,
  c.service_policy, c.service_policy_changed_at,
  c.care_cadence, c.care_cadence_changed_at,
  c.at_risk, m.at_risk_marked_at, m.risk_reason,
  c.closure_reason, c.closed_at,
  COALESCE(m.concurrency_token, md5(c.id::text || COALESCE(c.updated_at::text,''))::uuid) AS concurrency_token,
  c.updated_at
FROM public.clients c
LEFT JOIN public.crm_client_canonical_meta m ON m.client_id = c.id;

GRANT SELECT ON public.v_client_canonical_state TO authenticated;

CREATE OR REPLACE FUNCTION public._crm_ensure_meta(_client_id uuid, _tenant_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_token uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.crm_client_canonical_meta (client_id, tenant_id, concurrency_token)
  VALUES (_client_id, _tenant_id, new_token)
  ON CONFLICT (client_id) DO UPDATE
    SET concurrency_token = EXCLUDED.concurrency_token, updated_at = now();
  RETURN new_token;
END; $$;

CREATE OR REPLACE FUNCTION public._crm_idem_check(_key text, _actor uuid, _op text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE existing jsonb;
BEGIN
  IF _key IS NULL OR length(_key) = 0 THEN RETURN NULL; END IF;
  SELECT result_json INTO existing FROM public.crm_idempotency_keys
    WHERE key = _key AND operation = _op AND expires_at > now();
  RETURN existing;
END; $$;

CREATE OR REPLACE FUNCTION public._crm_idem_store(_key text, _actor uuid, _op text, _result jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _key IS NULL OR length(_key) = 0 THEN RETURN; END IF;
  INSERT INTO public.crm_idempotency_keys (key, actor_id, operation, result_json)
  VALUES (_key, _actor, _op, _result) ON CONFLICT (key) DO NOTHING;
END; $$;

CREATE OR REPLACE FUNCTION public.transition_client_lifecycle(
  client_id uuid, tenant_id uuid, to_stage public.client_lifecycle_stage_enum,
  reason text, concurrency_token uuid, contract_version text,
  disposition_reason public.client_closure_reason_enum DEFAULT NULL,
  idempotency_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE caller uuid := auth.uid(); cur_token uuid; cur_stage public.client_lifecycle_stage_enum; cached jsonb; r jsonb;
BEGIN
  IF caller IS NULL OR NOT public.crm_has_role(caller, tenant_id) THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'unauthorized'); END IF;
  cached := public._crm_idem_check(idempotency_key, caller, 'transition_client_lifecycle');
  IF cached IS NOT NULL THEN RETURN cached; END IF;
  SELECT COALESCE(m.concurrency_token, md5(c.id::text || COALESCE(c.updated_at::text,''))::uuid), c.lifecycle_stage
    INTO cur_token, cur_stage FROM public.clients c
    LEFT JOIN public.crm_client_canonical_meta m ON m.client_id = c.id
    WHERE c.id = client_id AND c.tenant_id = tenant_id;
  IF cur_token IS NULL THEN RETURN jsonb_build_object('ok', false, 'error_code', 'not_found'); END IF;
  IF cur_token <> concurrency_token THEN RETURN jsonb_build_object('ok', false, 'error_code', 'concurrency_conflict'); END IF;
  UPDATE public.clients
     SET lifecycle_stage = to_stage,
         lifecycle_stage_changed_at = now(),
         closure_reason = CASE WHEN to_stage = 'closed' THEN disposition_reason ELSE closure_reason END,
         closed_at      = CASE WHEN to_stage = 'closed' THEN now() ELSE closed_at END,
         updated_at     = now()
   WHERE id = client_id;
  PERFORM public._crm_ensure_meta(client_id, tenant_id);
  INSERT INTO public.crm_client_state_audit
    (tenant_id, client_id, dimension, from_value, to_value, reason, disposition_reason, actor_profile_id)
    VALUES (tenant_id, client_id, 'lifecycle_stage', cur_stage::text, to_stage::text, reason, disposition_reason::text, caller);
  r := jsonb_build_object('ok', true);
  PERFORM public._crm_idem_store(idempotency_key, caller, 'transition_client_lifecycle', r);
  RETURN r;
END; $$;

CREATE OR REPLACE FUNCTION public.set_client_engagement_state(
  client_id uuid, tenant_id uuid, to_state public.client_engagement_state_enum,
  reason text, concurrency_token uuid, contract_version text, idempotency_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE caller uuid := auth.uid(); cur_token uuid; cur_val public.client_engagement_state_enum; cached jsonb; r jsonb;
BEGIN
  IF caller IS NULL OR NOT public.crm_has_role(caller, tenant_id) THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'unauthorized'); END IF;
  cached := public._crm_idem_check(idempotency_key, caller, 'set_client_engagement_state');
  IF cached IS NOT NULL THEN RETURN cached; END IF;
  SELECT COALESCE(m.concurrency_token, md5(c.id::text || COALESCE(c.updated_at::text,''))::uuid), c.engagement_state
    INTO cur_token, cur_val FROM public.clients c
    LEFT JOIN public.crm_client_canonical_meta m ON m.client_id=c.id
    WHERE c.id=client_id AND c.tenant_id=tenant_id;
  IF cur_token IS NULL THEN RETURN jsonb_build_object('ok', false,'error_code','not_found'); END IF;
  IF cur_token <> concurrency_token THEN RETURN jsonb_build_object('ok', false,'error_code','concurrency_conflict'); END IF;
  UPDATE public.clients SET engagement_state=to_state, engagement_state_changed_at=now(), updated_at=now() WHERE id=client_id;
  PERFORM public._crm_ensure_meta(client_id, tenant_id);
  INSERT INTO public.crm_client_state_audit(tenant_id,client_id,dimension,from_value,to_value,reason,actor_profile_id)
    VALUES(tenant_id,client_id,'engagement_state',cur_val::text,to_state::text,reason,caller);
  r := jsonb_build_object('ok', true);
  PERFORM public._crm_idem_store(idempotency_key,caller,'set_client_engagement_state',r);
  RETURN r;
END; $$;

CREATE OR REPLACE FUNCTION public.set_client_contact_policy(
  client_id uuid, tenant_id uuid, to_policy public.client_contact_policy_enum,
  reason text, concurrency_token uuid, contract_version text, idempotency_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE caller uuid := auth.uid(); cur_token uuid; cur_val public.client_contact_policy_enum; cached jsonb; r jsonb;
BEGIN
  IF caller IS NULL OR NOT public.crm_has_role(caller, tenant_id) THEN
    RETURN jsonb_build_object('ok', false, 'error_code','unauthorized'); END IF;
  cached := public._crm_idem_check(idempotency_key, caller, 'set_client_contact_policy');
  IF cached IS NOT NULL THEN RETURN cached; END IF;
  SELECT COALESCE(m.concurrency_token, md5(c.id::text || COALESCE(c.updated_at::text,''))::uuid), c.contact_policy
    INTO cur_token, cur_val FROM public.clients c
    LEFT JOIN public.crm_client_canonical_meta m ON m.client_id=c.id
    WHERE c.id=client_id AND c.tenant_id=tenant_id;
  IF cur_token IS NULL THEN RETURN jsonb_build_object('ok', false,'error_code','not_found'); END IF;
  IF cur_token <> concurrency_token THEN RETURN jsonb_build_object('ok', false,'error_code','concurrency_conflict'); END IF;
  UPDATE public.clients SET contact_policy=to_policy, contact_policy_changed_at=now(), updated_at=now() WHERE id=client_id;
  PERFORM public._crm_ensure_meta(client_id, tenant_id);
  INSERT INTO public.crm_client_state_audit(tenant_id,client_id,dimension,from_value,to_value,reason,actor_profile_id)
    VALUES(tenant_id,client_id,'contact_policy',cur_val::text,to_policy::text,reason,caller);
  r := jsonb_build_object('ok', true);
  PERFORM public._crm_idem_store(idempotency_key,caller,'set_client_contact_policy',r);
  RETURN r;
END; $$;

CREATE OR REPLACE FUNCTION public.set_client_service_policy(
  client_id uuid, tenant_id uuid, to_policy public.client_service_policy_enum,
  reason text, concurrency_token uuid, contract_version text, idempotency_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE caller uuid := auth.uid(); cur_token uuid; cur_val public.client_service_policy_enum; cached jsonb; r jsonb;
BEGIN
  IF caller IS NULL OR NOT public.crm_has_role(caller, tenant_id) THEN
    RETURN jsonb_build_object('ok', false, 'error_code','unauthorized'); END IF;
  cached := public._crm_idem_check(idempotency_key, caller, 'set_client_service_policy');
  IF cached IS NOT NULL THEN RETURN cached; END IF;
  SELECT COALESCE(m.concurrency_token, md5(c.id::text || COALESCE(c.updated_at::text,''))::uuid), c.service_policy
    INTO cur_token, cur_val FROM public.clients c
    LEFT JOIN public.crm_client_canonical_meta m ON m.client_id=c.id
    WHERE c.id=client_id AND c.tenant_id=tenant_id;
  IF cur_token IS NULL THEN RETURN jsonb_build_object('ok', false,'error_code','not_found'); END IF;
  IF cur_token <> concurrency_token THEN RETURN jsonb_build_object('ok', false,'error_code','concurrency_conflict'); END IF;
  UPDATE public.clients SET service_policy=to_policy, service_policy_changed_at=now(), updated_at=now() WHERE id=client_id;
  PERFORM public._crm_ensure_meta(client_id, tenant_id);
  INSERT INTO public.crm_client_state_audit(tenant_id,client_id,dimension,from_value,to_value,reason,actor_profile_id)
    VALUES(tenant_id,client_id,'service_policy',cur_val::text,to_policy::text,reason,caller);
  r := jsonb_build_object('ok', true);
  PERFORM public._crm_idem_store(idempotency_key,caller,'set_client_service_policy',r);
  RETURN r;
END; $$;

CREATE OR REPLACE FUNCTION public.set_client_eligibility_state(
  client_id uuid, tenant_id uuid, to_state public.client_eligibility_state_enum,
  reason text, concurrency_token uuid, contract_version text, idempotency_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE caller uuid := auth.uid(); cur_token uuid; cur_val public.client_eligibility_state_enum; cached jsonb; r jsonb;
BEGIN
  IF caller IS NULL OR NOT public.crm_has_role(caller, tenant_id) THEN
    RETURN jsonb_build_object('ok', false, 'error_code','unauthorized'); END IF;
  cached := public._crm_idem_check(idempotency_key, caller, 'set_client_eligibility_state');
  IF cached IS NOT NULL THEN RETURN cached; END IF;
  SELECT COALESCE(m.concurrency_token, md5(c.id::text || COALESCE(c.updated_at::text,''))::uuid), c.eligibility_state
    INTO cur_token, cur_val FROM public.clients c
    LEFT JOIN public.crm_client_canonical_meta m ON m.client_id=c.id
    WHERE c.id=client_id AND c.tenant_id=tenant_id;
  IF cur_token IS NULL THEN RETURN jsonb_build_object('ok', false,'error_code','not_found'); END IF;
  IF cur_token <> concurrency_token THEN RETURN jsonb_build_object('ok', false,'error_code','concurrency_conflict'); END IF;
  UPDATE public.clients SET eligibility_state=to_state, eligibility_state_changed_at=now(), updated_at=now() WHERE id=client_id;
  PERFORM public._crm_ensure_meta(client_id, tenant_id);
  INSERT INTO public.crm_client_state_audit(tenant_id,client_id,dimension,from_value,to_value,reason,actor_profile_id)
    VALUES(tenant_id,client_id,'eligibility_state',cur_val::text,to_state::text,reason,caller);
  r := jsonb_build_object('ok', true);
  PERFORM public._crm_idem_store(idempotency_key,caller,'set_client_eligibility_state',r);
  RETURN r;
END; $$;

CREATE OR REPLACE FUNCTION public.set_client_care_cadence(
  client_id uuid, tenant_id uuid, to_cadence public.client_care_cadence_enum,
  reason text, concurrency_token uuid, contract_version text, idempotency_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE caller uuid := auth.uid(); cur_token uuid; cur_val public.client_care_cadence_enum; cached jsonb; r jsonb;
BEGIN
  IF caller IS NULL OR NOT public.crm_has_role(caller, tenant_id) THEN
    RETURN jsonb_build_object('ok', false, 'error_code','unauthorized'); END IF;
  cached := public._crm_idem_check(idempotency_key, caller, 'set_client_care_cadence');
  IF cached IS NOT NULL THEN RETURN cached; END IF;
  SELECT COALESCE(m.concurrency_token, md5(c.id::text || COALESCE(c.updated_at::text,''))::uuid), c.care_cadence
    INTO cur_token, cur_val FROM public.clients c
    LEFT JOIN public.crm_client_canonical_meta m ON m.client_id=c.id
    WHERE c.id=client_id AND c.tenant_id=tenant_id;
  IF cur_token IS NULL THEN RETURN jsonb_build_object('ok', false,'error_code','not_found'); END IF;
  IF cur_token <> concurrency_token THEN RETURN jsonb_build_object('ok', false,'error_code','concurrency_conflict'); END IF;
  UPDATE public.clients SET care_cadence=to_cadence, care_cadence_changed_at=now(), updated_at=now() WHERE id=client_id;
  PERFORM public._crm_ensure_meta(client_id, tenant_id);
  INSERT INTO public.crm_client_state_audit(tenant_id,client_id,dimension,from_value,to_value,reason,actor_profile_id)
    VALUES(tenant_id,client_id,'care_cadence',cur_val::text,to_cadence::text,reason,caller);
  r := jsonb_build_object('ok', true);
  PERFORM public._crm_idem_store(idempotency_key,caller,'set_client_care_cadence',r);
  RETURN r;
END; $$;

CREATE OR REPLACE FUNCTION public.set_client_disposition(
  client_id uuid, tenant_id uuid, disposition_reason public.client_closure_reason_enum,
  reason text, concurrency_token uuid, contract_version text, idempotency_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE caller uuid := auth.uid(); cur_token uuid; cur_val public.client_closure_reason_enum; cached jsonb; r jsonb;
BEGIN
  IF caller IS NULL OR NOT public.crm_has_role(caller, tenant_id) THEN
    RETURN jsonb_build_object('ok', false, 'error_code','unauthorized'); END IF;
  cached := public._crm_idem_check(idempotency_key, caller, 'set_client_disposition');
  IF cached IS NOT NULL THEN RETURN cached; END IF;
  SELECT COALESCE(m.concurrency_token, md5(c.id::text || COALESCE(c.updated_at::text,''))::uuid), c.closure_reason
    INTO cur_token, cur_val FROM public.clients c
    LEFT JOIN public.crm_client_canonical_meta m ON m.client_id=c.id
    WHERE c.id=client_id AND c.tenant_id=tenant_id;
  IF cur_token IS NULL THEN RETURN jsonb_build_object('ok', false,'error_code','not_found'); END IF;
  IF cur_token <> concurrency_token THEN RETURN jsonb_build_object('ok', false,'error_code','concurrency_conflict'); END IF;
  UPDATE public.clients
     SET closure_reason=disposition_reason,
         closed_at = COALESCE(closed_at, now()),
         lifecycle_stage='closed',
         lifecycle_stage_changed_at = CASE WHEN lifecycle_stage <> 'closed' THEN now() ELSE lifecycle_stage_changed_at END,
         updated_at=now()
   WHERE id=client_id;
  PERFORM public._crm_ensure_meta(client_id, tenant_id);
  INSERT INTO public.crm_client_state_audit(tenant_id,client_id,dimension,from_value,to_value,reason,disposition_reason,actor_profile_id)
    VALUES(tenant_id,client_id,'closure_reason',cur_val::text,disposition_reason::text,reason,disposition_reason::text,caller);
  r := jsonb_build_object('ok', true);
  PERFORM public._crm_idem_store(idempotency_key,caller,'set_client_disposition',r);
  RETURN r;
END; $$;

GRANT EXECUTE ON FUNCTION public.transition_client_lifecycle(uuid,uuid,public.client_lifecycle_stage_enum,text,uuid,text,public.client_closure_reason_enum,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_client_engagement_state(uuid,uuid,public.client_engagement_state_enum,text,uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_client_contact_policy(uuid,uuid,public.client_contact_policy_enum,text,uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_client_service_policy(uuid,uuid,public.client_service_policy_enum,text,uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_client_eligibility_state(uuid,uuid,public.client_eligibility_state_enum,text,uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_client_care_cadence(uuid,uuid,public.client_care_cadence_enum,text,uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_client_disposition(uuid,uuid,public.client_closure_reason_enum,text,uuid,text,text) TO authenticated;
