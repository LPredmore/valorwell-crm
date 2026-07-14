
-- ============================================================
-- PHASE 2: Lifecycle & communication-policy RPCs
-- ============================================================

-- ---------- Label <-> enum mapping helpers (internal) ----------
CREATE OR REPLACE FUNCTION public._crm_lifecycle_from_label(_label text)
RETURNS public.client_lifecycle_stage_enum LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(_label)
    WHEN 'registration'      THEN 'registration'
    WHEN 'intake'            THEN 'intake'
    WHEN 'matching'          THEN 'matching'
    WHEN 'matched'           THEN 'matched'
    WHEN 'scheduled'         THEN 'scheduled'
    WHEN 'early care'        THEN 'early_care'
    WHEN 'established care'  THEN 'established_care'
    WHEN 'closed'            THEN 'closed'
  END::public.client_lifecycle_stage_enum;
$$;

CREATE OR REPLACE FUNCTION public._crm_lifecycle_to_label(_v public.client_lifecycle_stage_enum)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _v::text
    WHEN 'registration'      THEN 'Registration'
    WHEN 'intake'            THEN 'Intake'
    WHEN 'matching'          THEN 'Matching'
    WHEN 'matched'           THEN 'Matched'
    WHEN 'scheduled'         THEN 'Scheduled'
    WHEN 'early_care'        THEN 'Early Care'
    WHEN 'established_care'  THEN 'Established Care'
    WHEN 'closed'            THEN 'Closed'
  END;
$$;

CREATE OR REPLACE FUNCTION public._crm_engagement_from_label(_label text)
RETURNS public.client_engagement_state_enum LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(_label)
    WHEN 'normal'              THEN 'normal'
    WHEN 'unresponsive warm'   THEN 'unresponsive_warm'
    WHEN 'unresponsive cold'   THEN 'unresponsive_cold'
    WHEN 'went dark'           THEN 'went_dark'
  END::public.client_engagement_state_enum;
$$;

CREATE OR REPLACE FUNCTION public._crm_engagement_to_label(_v public.client_engagement_state_enum)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _v::text
    WHEN 'normal'              THEN 'Normal'
    WHEN 'unresponsive_warm'   THEN 'Unresponsive Warm'
    WHEN 'unresponsive_cold'   THEN 'Unresponsive Cold'
    WHEN 'went_dark'           THEN 'Went Dark'
  END;
$$;

CREATE OR REPLACE FUNCTION public._crm_contact_policy_from_label(_label text)
RETURNS public.client_contact_policy_enum LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(_label)
    WHEN 'normal'           THEN 'normal'
    WHEN 'do not contact'   THEN 'do_not_contact'
  END::public.client_contact_policy_enum;
$$;

CREATE OR REPLACE FUNCTION public._crm_contact_policy_to_label(_v public.client_contact_policy_enum)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _v::text WHEN 'normal' THEN 'Normal' WHEN 'do_not_contact' THEN 'Do Not Contact' END;
$$;

CREATE OR REPLACE FUNCTION public._crm_service_policy_from_label(_label text)
RETURNS public.client_service_policy_enum LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(_label)
    WHEN 'normal'           THEN 'normal'
    WHEN 'service blocked'  THEN 'service_blocked'
  END::public.client_service_policy_enum;
$$;

CREATE OR REPLACE FUNCTION public._crm_service_policy_to_label(_v public.client_service_policy_enum)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _v::text WHEN 'normal' THEN 'Normal' WHEN 'service_blocked' THEN 'Service Blocked' END;
$$;

CREATE OR REPLACE FUNCTION public._crm_eligibility_from_label(_label text)
RETURNS public.client_eligibility_state_enum LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(_label)
    WHEN 'eligible'         THEN 'eligible'
    WHEN 'coverage issue'   THEN 'coverage_issue'
    WHEN 'manual review'    THEN 'manual_review'
    WHEN 'unknown'          THEN 'unknown'
  END::public.client_eligibility_state_enum;
$$;

CREATE OR REPLACE FUNCTION public._crm_eligibility_to_label(_v public.client_eligibility_state_enum)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _v::text
    WHEN 'eligible'        THEN 'Eligible'
    WHEN 'coverage_issue'  THEN 'Coverage Issue'
    WHEN 'manual_review'   THEN 'Manual Review'
    WHEN 'unknown'         THEN 'Unknown'
  END;
$$;

CREATE OR REPLACE FUNCTION public._crm_closure_from_label(_label text)
RETURNS public.client_closure_reason_enum LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(_label)
    WHEN 'not the right time'    THEN 'not_the_right_time'
    WHEN 'found somewhere else'  THEN 'found_somewhere_else'
    WHEN 'completed care'        THEN 'completed_care'
    WHEN 'paused care'           THEN 'paused_care'
    WHEN 'administrative'        THEN 'administrative'
    WHEN 'went dark'             THEN 'went_dark'
    WHEN 'other'                 THEN 'other'
  END::public.client_closure_reason_enum;
$$;

CREATE OR REPLACE FUNCTION public._crm_closure_to_label(_v public.client_closure_reason_enum)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _v::text
    WHEN 'not_the_right_time'   THEN 'Not the Right Time'
    WHEN 'found_somewhere_else' THEN 'Found Somewhere Else'
    WHEN 'completed_care'       THEN 'Completed Care'
    WHEN 'paused_care'          THEN 'Paused Care'
    WHEN 'administrative'       THEN 'Administrative'
    WHEN 'went_dark'            THEN 'Went Dark'
    WHEN 'other'                THEN 'Other'
  END;
$$;

CREATE OR REPLACE FUNCTION public._crm_cadence_from_label(_label text)
RETURNS public.client_care_cadence_enum LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(_label)
    WHEN 'regular'    THEN 'regular'
    WHEN 'as_needed'  THEN 'as_needed'
    WHEN 'as needed'  THEN 'as_needed'
  END::public.client_care_cadence_enum;
$$;

REVOKE ALL ON FUNCTION
  public._crm_lifecycle_from_label(text),
  public._crm_lifecycle_to_label(public.client_lifecycle_stage_enum),
  public._crm_engagement_from_label(text),
  public._crm_engagement_to_label(public.client_engagement_state_enum),
  public._crm_contact_policy_from_label(text),
  public._crm_contact_policy_to_label(public.client_contact_policy_enum),
  public._crm_service_policy_from_label(text),
  public._crm_service_policy_to_label(public.client_service_policy_enum),
  public._crm_eligibility_from_label(text),
  public._crm_eligibility_to_label(public.client_eligibility_state_enum),
  public._crm_closure_from_label(text),
  public._crm_closure_to_label(public.client_closure_reason_enum),
  public._crm_cadence_from_label(text)
FROM PUBLIC, anon, authenticated;

-- ---------- Recreate view with display labels ----------
DROP VIEW IF EXISTS public.v_client_canonical_state;

CREATE VIEW public.v_client_canonical_state
WITH (security_invoker = true) AS
SELECT
  c.id                                             AS client_id,
  c.tenant_id                                      AS tenant_id,
  COALESCE(c.contract_version::text, '0')          AS contract_version,
  public._crm_lifecycle_to_label(c.lifecycle_stage)     AS lifecycle,
  public._crm_engagement_to_label(c.engagement_state)   AS engagement,
  jsonb_build_object(
    'at_risk',                    COALESCE(c.at_risk, false),
    'evaluated_at',               COALESCE(c.at_risk_since, c.updated_at),
    'recommended_next_action',    NULL,
    'event_version',              COALESCE(c.contract_version::text, '0')
  )                                                AS at_risk,
  public._crm_eligibility_to_label(c.eligibility_state) AS eligibility,
  NULL::jsonb                                      AS eligibility_manual_review,
  public._crm_contact_policy_to_label(c.contact_policy) AS contact_policy,
  public._crm_service_policy_to_label(c.service_policy) AS service_policy,
  c.care_cadence::text                             AS care_cadence,
  public._crm_closure_to_label(c.closure_reason)   AS disposition_reason,
  c.closed_at                                      AS disposition_at,
  c.primary_staff_id                               AS assigned_therapist_id,
  (
    SELECT MIN(a.start_at)
    FROM public.appointments a
    WHERE a.client_id = c.id
      AND a.start_at > now()
      AND a.status::text NOT IN ('cancelled','no_show')
  )                                                AS next_appointment_at,
  COALESCE((
    SELECT CASE
      WHEN d.resolved_at IS NOT NULL              THEN 'resolved'
      WHEN COALESCE(d.last_option_count, 0) > 0   THEN 'options_available'
      WHEN d.pathway_code = 'wait'                THEN 'wait_active'
      ELSE 'open'
    END
    FROM public.client_provider_demand d
    WHERE d.client_id = c.id
    ORDER BY d.opened_at DESC
    LIMIT 1
  ), 'none')                                       AS provider_demand_state,
  COALESCE(m.concurrency_token::text,
           md5(c.id::text || COALESCE(c.updated_at::text,'')))
                                                   AS concurrency_token,
  c.updated_at                                     AS updated_at
FROM public.clients c
LEFT JOIN public.crm_client_canonical_meta m
       ON m.client_id = c.id AND m.tenant_id = c.tenant_id
WHERE c.tenant_id IN (
  SELECT tm.tenant_id
  FROM public.tenant_memberships tm
  WHERE tm.profile_id = auth.uid()
);

REVOKE ALL ON public.v_client_canonical_state FROM PUBLIC, anon;
GRANT  SELECT ON public.v_client_canonical_state TO authenticated;

-- ---------- Internal audit + activity emitter ----------
CREATE OR REPLACE FUNCTION public._crm_emit_state_change(
  _tenant_id uuid,
  _client_id uuid,
  _dimension public.client_state_dimension_enum,
  _from_value text,
  _to_value text,
  _reason text,
  _disposition_reason text,
  _actor uuid,
  _correlation_id uuid,
  _activity_event_type text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.crm_client_state_audit(
    tenant_id, client_id, dimension, from_value, to_value,
    reason, disposition_reason, actor_profile_id, actor_label,
    source, correlation_id
  ) VALUES (
    _tenant_id, _client_id, _dimension, _from_value, _to_value,
    _reason, _disposition_reason, _actor, 'crm_user',
    'crm', _correlation_id
  );

  INSERT INTO public.crm_activity_events(
    tenant_id, client_id, event_type, old_value, new_value, metadata, created_by_profile_id
  ) VALUES (
    _tenant_id, _client_id, _activity_event_type, _from_value, _to_value,
    jsonb_build_object(
      'reason', _reason,
      'correlation_id', _correlation_id,
      'dimension', _dimension::text,
      'disposition_reason', _disposition_reason
    ),
    _actor
  );
END $$;

REVOKE ALL ON FUNCTION public._crm_emit_state_change(uuid,uuid,public.client_state_dimension_enum,text,text,text,text,uuid,uuid,text)
  FROM PUBLIC, anon, authenticated;

-- ---------- Idempotency helper ----------
CREATE OR REPLACE FUNCTION public._crm_idem_check(_key text, _actor uuid, _op text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  DELETE FROM public.crm_idempotency_keys WHERE expires_at < now();
  SELECT result_json INTO r
  FROM public.crm_idempotency_keys
  WHERE key = _key AND actor_id = _actor AND operation = _op;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public._crm_idem_store(_key text, _actor uuid, _op text, _result jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.crm_idempotency_keys(key, actor_id, operation, result_json, expires_at)
  VALUES (_key, _actor, _op, _result, now() + interval '24 hours')
  ON CONFLICT DO NOTHING;
END $$;

REVOKE ALL ON FUNCTION public._crm_idem_check(text,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._crm_idem_store(text,uuid,text,jsonb) FROM PUBLIC, anon, authenticated;

-- ---------- Shared authorization/concurrency guard ----------
-- Returns tenant_id if authorized; raises structured error otherwise.
CREATE OR REPLACE FUNCTION public._crm_authorize_client_write(
  _client_id uuid,
  _concurrency_token text
) RETURNS TABLE(tenant_id uuid, current_lifecycle public.client_lifecycle_stage_enum,
                current_engagement public.client_engagement_state_enum,
                current_contact public.client_contact_policy_enum,
                current_service public.client_service_policy_enum,
                current_eligibility public.client_eligibility_state_enum,
                current_cadence public.client_care_cadence_enum,
                current_closure public.client_closure_reason_enum,
                current_therapist uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _actor uuid := auth.uid();
  _tenant uuid;
  _tok text;
BEGIN
  IF _actor IS NULL THEN
    RAISE EXCEPTION 'CRM_UNAUTHORIZED' USING ERRCODE='42501';
  END IF;

  SELECT c.tenant_id INTO _tenant FROM public.clients c WHERE c.id = _client_id;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'CRM_UNAUTHORIZED' USING ERRCODE='42501';
  END IF;

  IF NOT public.crm_has_role(_actor, ARRAY['admin','staff'], _tenant) THEN
    RAISE EXCEPTION 'CRM_UNAUTHORIZED' USING ERRCODE='42501';
  END IF;

  SELECT COALESCE(m.concurrency_token::text,
                  md5(c.id::text || COALESCE(c.updated_at::text,'')))
    INTO _tok
  FROM public.clients c
  LEFT JOIN public.crm_client_canonical_meta m
         ON m.client_id = c.id AND m.tenant_id = c.tenant_id
  WHERE c.id = _client_id;

  IF _concurrency_token IS NULL OR _concurrency_token <> 'auto' THEN
    IF _tok <> _concurrency_token THEN
      RAISE EXCEPTION 'CRM_CONCURRENCY' USING ERRCODE='40001';
    END IF;
  END IF;

  RETURN QUERY
  SELECT c.tenant_id, c.lifecycle_stage, c.engagement_state, c.contact_policy,
         c.service_policy, c.eligibility_state, c.care_cadence, c.closure_reason,
         c.primary_staff_id
  FROM public.clients c WHERE c.id = _client_id;
END $$;

REVOKE ALL ON FUNCTION public._crm_authorize_client_write(uuid,text) FROM PUBLIC, anon, authenticated;

-- Post-write: bump concurrency token
CREATE OR REPLACE FUNCTION public._crm_bump_token(_client_id uuid, _tenant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.crm_client_canonical_meta(client_id, tenant_id, concurrency_token, updated_at)
  VALUES (_client_id, _tenant_id, gen_random_uuid(), now())
  ON CONFLICT (client_id) DO UPDATE
    SET concurrency_token = gen_random_uuid(), updated_at = now();
END $$;
REVOKE ALL ON FUNCTION public._crm_bump_token(uuid,uuid) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- A1.2  crm_transition_lifecycle
-- ============================================================
CREATE OR REPLACE FUNCTION public.crm_transition_lifecycle(
  p_client_id uuid,
  p_to_stage text,
  p_reason text,
  p_disposition_reason text DEFAULT NULL,
  p_concurrency_token text DEFAULT 'auto',
  p_idempotency_key uuid DEFAULT NULL,
  p_contract_version text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _actor uuid := auth.uid();
  _cached jsonb;
  _to public.client_lifecycle_stage_enum;
  _tenant uuid;
  _cur   public.client_lifecycle_stage_enum;
  _closure public.client_closure_reason_enum;
  _row RECORD;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    _cached := public._crm_idem_check(p_idempotency_key::text, _actor, 'crm_transition_lifecycle');
    IF _cached IS NOT NULL THEN RETURN _cached; END IF;
  END IF;

  BEGIN
    SELECT * INTO _row FROM public._crm_authorize_client_write(p_client_id, p_concurrency_token);
  EXCEPTION
    WHEN sqlstate '42501' THEN RETURN jsonb_build_object('ok',false,'error_code','unauthorized');
    WHEN sqlstate '40001' THEN RETURN jsonb_build_object('ok',false,'error_code','concurrency_conflict');
  END;
  _tenant := _row.tenant_id; _cur := _row.current_lifecycle;

  _to := public._crm_lifecycle_from_label(p_to_stage);
  IF _to IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error_code','invalid_transition','message','unknown_stage');
  END IF;

  IF _to = _cur THEN
    -- no-op
    RETURN jsonb_build_object('ok',true);
  END IF;

  IF _to = 'closed'::public.client_lifecycle_stage_enum THEN
    IF p_disposition_reason IS NULL THEN
      RETURN jsonb_build_object('ok',false,'error_code','invalid_transition','message','disposition_reason_required');
    END IF;
    _closure := public._crm_closure_from_label(p_disposition_reason);
    IF _closure IS NULL THEN
      RETURN jsonb_build_object('ok',false,'error_code','invalid_transition','message','unknown_disposition_reason');
    END IF;
  END IF;

  UPDATE public.clients SET
    lifecycle_stage = _to,
    lifecycle_stage_changed_at = now(),
    closure_reason = CASE WHEN _to='closed'::public.client_lifecycle_stage_enum THEN _closure ELSE closure_reason END,
    closed_at      = CASE WHEN _to='closed'::public.client_lifecycle_stage_enum THEN now()     ELSE closed_at END,
    updated_at = now()
  WHERE id = p_client_id;

  PERFORM public._crm_emit_state_change(
    _tenant, p_client_id, 'lifecycle_stage'::public.client_state_dimension_enum,
    _cur::text, _to::text, p_reason, p_disposition_reason, _actor,
    p_idempotency_key, 'lifecycle_changed');
  PERFORM public._crm_bump_token(p_client_id, _tenant);

  IF p_idempotency_key IS NOT NULL THEN
    PERFORM public._crm_idem_store(p_idempotency_key::text, _actor, 'crm_transition_lifecycle', jsonb_build_object('ok',true));
  END IF;
  RETURN jsonb_build_object('ok',true);
END $$;

REVOKE ALL ON FUNCTION public.crm_transition_lifecycle(uuid,text,text,text,text,uuid,text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.crm_transition_lifecycle(uuid,text,text,text,text,uuid,text) TO authenticated, service_role;

-- ============================================================
-- A1.3  crm_set_engagement
-- ============================================================
CREATE OR REPLACE FUNCTION public.crm_set_engagement(
  p_client_id uuid, p_to_state text, p_reason text,
  p_concurrency_token text DEFAULT 'auto',
  p_idempotency_key uuid DEFAULT NULL,
  p_contract_version text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _actor uuid := auth.uid(); _cached jsonb;
  _to public.client_engagement_state_enum; _row RECORD; _tenant uuid; _cur public.client_engagement_state_enum;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    _cached := public._crm_idem_check(p_idempotency_key::text, _actor, 'crm_set_engagement');
    IF _cached IS NOT NULL THEN RETURN _cached; END IF;
  END IF;
  BEGIN
    SELECT * INTO _row FROM public._crm_authorize_client_write(p_client_id, p_concurrency_token);
  EXCEPTION
    WHEN sqlstate '42501' THEN RETURN jsonb_build_object('ok',false,'error_code','unauthorized');
    WHEN sqlstate '40001' THEN RETURN jsonb_build_object('ok',false,'error_code','concurrency_conflict');
  END;
  _tenant := _row.tenant_id; _cur := _row.current_engagement;
  _to := public._crm_engagement_from_label(p_to_state);
  IF _to IS NULL THEN RETURN jsonb_build_object('ok',false,'error_code','invalid_transition','message','unknown_state'); END IF;

  UPDATE public.clients SET engagement_state=_to, engagement_state_changed_at=now(), updated_at=now() WHERE id=p_client_id;
  PERFORM public._crm_emit_state_change(_tenant,p_client_id,'engagement_state'::public.client_state_dimension_enum,
    _cur::text,_to::text,p_reason,NULL,_actor,p_idempotency_key,'engagement_changed');
  PERFORM public._crm_bump_token(p_client_id,_tenant);
  IF p_idempotency_key IS NOT NULL THEN PERFORM public._crm_idem_store(p_idempotency_key::text,_actor,'crm_set_engagement',jsonb_build_object('ok',true)); END IF;
  RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.crm_set_engagement(uuid,text,text,text,uuid,text) FROM PUBLIC,anon;
GRANT  EXECUTE ON FUNCTION public.crm_set_engagement(uuid,text,text,text,uuid,text) TO authenticated,service_role;

-- ============================================================
-- A1.4  crm_set_contact_policy  (also cancels active campaigns on DNC)
-- ============================================================
CREATE OR REPLACE FUNCTION public.crm_set_contact_policy(
  p_client_id uuid, p_to_policy text, p_reason text,
  p_concurrency_token text DEFAULT 'auto',
  p_idempotency_key uuid DEFAULT NULL,
  p_contract_version text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _actor uuid := auth.uid(); _cached jsonb;
  _to public.client_contact_policy_enum; _row RECORD; _tenant uuid; _cur public.client_contact_policy_enum;
  _enr RECORD;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    _cached := public._crm_idem_check(p_idempotency_key::text,_actor,'crm_set_contact_policy');
    IF _cached IS NOT NULL THEN RETURN _cached; END IF;
  END IF;
  BEGIN
    SELECT * INTO _row FROM public._crm_authorize_client_write(p_client_id, p_concurrency_token);
  EXCEPTION
    WHEN sqlstate '42501' THEN RETURN jsonb_build_object('ok',false,'error_code','unauthorized');
    WHEN sqlstate '40001' THEN RETURN jsonb_build_object('ok',false,'error_code','concurrency_conflict');
  END;
  _tenant := _row.tenant_id; _cur := _row.current_contact;
  _to := public._crm_contact_policy_from_label(p_to_policy);
  IF _to IS NULL THEN RETURN jsonb_build_object('ok',false,'error_code','invalid_transition','message','unknown_policy'); END IF;

  UPDATE public.clients SET contact_policy=_to, contact_policy_changed_at=now(), updated_at=now() WHERE id=p_client_id;
  PERFORM public._crm_emit_state_change(_tenant,p_client_id,'contact_policy'::public.client_state_dimension_enum,
    _cur::text,_to::text,p_reason,NULL,_actor,p_idempotency_key,'contact_policy_changed');

  IF _to = 'do_not_contact'::public.client_contact_policy_enum THEN
    FOR _enr IN
      SELECT id FROM public.crm_campaign_enrollments
      WHERE client_id=p_client_id AND status='active'
    LOOP
      UPDATE public.crm_campaign_enrollments
        SET status='cancelled', pause_reason='DNC set via crm_set_contact_policy', updated_at=now()
        WHERE id=_enr.id;
      INSERT INTO public.crm_activity_events(tenant_id,client_id,event_type,old_value,new_value,metadata,created_by_profile_id)
      VALUES (_tenant,p_client_id,'campaign_cancelled_by_policy','active','cancelled',
              jsonb_build_object('enrollment_id',_enr.id,'reason','DNC'),_actor);
    END LOOP;
  END IF;

  PERFORM public._crm_bump_token(p_client_id,_tenant);
  IF p_idempotency_key IS NOT NULL THEN PERFORM public._crm_idem_store(p_idempotency_key::text,_actor,'crm_set_contact_policy',jsonb_build_object('ok',true)); END IF;
  RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.crm_set_contact_policy(uuid,text,text,text,uuid,text) FROM PUBLIC,anon;
GRANT  EXECUTE ON FUNCTION public.crm_set_contact_policy(uuid,text,text,text,uuid,text) TO authenticated,service_role;

-- ============================================================
-- A1.5  crm_set_service_policy
-- ============================================================
CREATE OR REPLACE FUNCTION public.crm_set_service_policy(
  p_client_id uuid, p_to_policy text, p_reason text,
  p_concurrency_token text DEFAULT 'auto',
  p_idempotency_key uuid DEFAULT NULL,
  p_contract_version text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _actor uuid:=auth.uid(); _cached jsonb; _to public.client_service_policy_enum; _row RECORD; _tenant uuid; _cur public.client_service_policy_enum;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    _cached:=public._crm_idem_check(p_idempotency_key::text,_actor,'crm_set_service_policy');
    IF _cached IS NOT NULL THEN RETURN _cached; END IF;
  END IF;
  BEGIN
    SELECT * INTO _row FROM public._crm_authorize_client_write(p_client_id, p_concurrency_token);
  EXCEPTION
    WHEN sqlstate '42501' THEN RETURN jsonb_build_object('ok',false,'error_code','unauthorized');
    WHEN sqlstate '40001' THEN RETURN jsonb_build_object('ok',false,'error_code','concurrency_conflict');
  END;
  _tenant:=_row.tenant_id; _cur:=_row.current_service;
  _to:=public._crm_service_policy_from_label(p_to_policy);
  IF _to IS NULL THEN RETURN jsonb_build_object('ok',false,'error_code','invalid_transition','message','unknown_policy'); END IF;
  UPDATE public.clients SET service_policy=_to, service_policy_changed_at=now(), updated_at=now() WHERE id=p_client_id;
  PERFORM public._crm_emit_state_change(_tenant,p_client_id,'service_policy'::public.client_state_dimension_enum,
    _cur::text,_to::text,p_reason,NULL,_actor,p_idempotency_key,'service_policy_changed');
  PERFORM public._crm_bump_token(p_client_id,_tenant);
  IF p_idempotency_key IS NOT NULL THEN PERFORM public._crm_idem_store(p_idempotency_key::text,_actor,'crm_set_service_policy',jsonb_build_object('ok',true)); END IF;
  RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.crm_set_service_policy(uuid,text,text,text,uuid,text) FROM PUBLIC,anon;
GRANT  EXECUTE ON FUNCTION public.crm_set_service_policy(uuid,text,text,text,uuid,text) TO authenticated,service_role;

-- ============================================================
-- A1.6  crm_set_eligibility
-- ============================================================
CREATE OR REPLACE FUNCTION public.crm_set_eligibility(
  p_client_id uuid, p_to_state text, p_manual_review jsonb DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_concurrency_token text DEFAULT 'auto',
  p_idempotency_key uuid DEFAULT NULL,
  p_contract_version text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _actor uuid:=auth.uid(); _cached jsonb; _to public.client_eligibility_state_enum; _row RECORD; _tenant uuid; _cur public.client_eligibility_state_enum;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    _cached:=public._crm_idem_check(p_idempotency_key::text,_actor,'crm_set_eligibility');
    IF _cached IS NOT NULL THEN RETURN _cached; END IF;
  END IF;
  BEGIN
    SELECT * INTO _row FROM public._crm_authorize_client_write(p_client_id, p_concurrency_token);
  EXCEPTION
    WHEN sqlstate '42501' THEN RETURN jsonb_build_object('ok',false,'error_code','unauthorized');
    WHEN sqlstate '40001' THEN RETURN jsonb_build_object('ok',false,'error_code','concurrency_conflict');
  END;
  _tenant:=_row.tenant_id; _cur:=_row.current_eligibility;
  _to:=public._crm_eligibility_from_label(p_to_state);
  IF _to IS NULL THEN RETURN jsonb_build_object('ok',false,'error_code','invalid_transition','message','unknown_state'); END IF;
  IF _to='manual_review'::public.client_eligibility_state_enum THEN
    IF p_manual_review IS NULL OR NOT (p_manual_review ? 'owner' AND p_manual_review ? 'next_action' AND p_manual_review ? 'review_due_at') THEN
      RETURN jsonb_build_object('ok',false,'error_code','invalid_transition','message','manual_review_payload_required');
    END IF;
  END IF;
  UPDATE public.clients SET eligibility_state=_to, eligibility_state_changed_at=now(), updated_at=now() WHERE id=p_client_id;
  PERFORM public._crm_emit_state_change(_tenant,p_client_id,'eligibility_state'::public.client_state_dimension_enum,
    _cur::text,_to::text,p_reason,NULL,_actor,p_idempotency_key,'eligibility_changed');
  PERFORM public._crm_bump_token(p_client_id,_tenant);
  IF p_idempotency_key IS NOT NULL THEN PERFORM public._crm_idem_store(p_idempotency_key::text,_actor,'crm_set_eligibility',jsonb_build_object('ok',true)); END IF;
  RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.crm_set_eligibility(uuid,text,jsonb,text,text,uuid,text) FROM PUBLIC,anon;
GRANT  EXECUTE ON FUNCTION public.crm_set_eligibility(uuid,text,jsonb,text,text,uuid,text) TO authenticated,service_role;

-- ============================================================
-- A1.7  crm_set_care_cadence
-- ============================================================
CREATE OR REPLACE FUNCTION public.crm_set_care_cadence(
  p_client_id uuid, p_to_cadence text, p_reason text,
  p_concurrency_token text DEFAULT 'auto',
  p_idempotency_key uuid DEFAULT NULL,
  p_contract_version text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _actor uuid:=auth.uid(); _cached jsonb; _to public.client_care_cadence_enum; _row RECORD; _tenant uuid; _cur public.client_care_cadence_enum;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    _cached:=public._crm_idem_check(p_idempotency_key::text,_actor,'crm_set_care_cadence');
    IF _cached IS NOT NULL THEN RETURN _cached; END IF;
  END IF;
  BEGIN
    SELECT * INTO _row FROM public._crm_authorize_client_write(p_client_id, p_concurrency_token);
  EXCEPTION
    WHEN sqlstate '42501' THEN RETURN jsonb_build_object('ok',false,'error_code','unauthorized');
    WHEN sqlstate '40001' THEN RETURN jsonb_build_object('ok',false,'error_code','concurrency_conflict');
  END;
  _tenant:=_row.tenant_id; _cur:=_row.current_cadence;
  _to:=public._crm_cadence_from_label(p_to_cadence);
  IF _to IS NULL THEN RETURN jsonb_build_object('ok',false,'error_code','invalid_transition','message','unknown_cadence'); END IF;
  UPDATE public.clients SET care_cadence=_to, care_cadence_changed_at=now(), updated_at=now() WHERE id=p_client_id;
  PERFORM public._crm_emit_state_change(_tenant,p_client_id,'care_cadence'::public.client_state_dimension_enum,
    _cur::text,_to::text,p_reason,NULL,_actor,p_idempotency_key,'care_cadence_changed');
  PERFORM public._crm_bump_token(p_client_id,_tenant);
  IF p_idempotency_key IS NOT NULL THEN PERFORM public._crm_idem_store(p_idempotency_key::text,_actor,'crm_set_care_cadence',jsonb_build_object('ok',true)); END IF;
  RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.crm_set_care_cadence(uuid,text,text,text,uuid,text) FROM PUBLIC,anon;
GRANT  EXECUTE ON FUNCTION public.crm_set_care_cadence(uuid,text,text,text,uuid,text) TO authenticated,service_role;

-- ============================================================
-- A1.8  crm_assign_clinician
-- ============================================================
CREATE OR REPLACE FUNCTION public.crm_assign_clinician(
  p_client_id uuid, p_staff_id uuid, p_reason text,
  p_concurrency_token text DEFAULT 'auto',
  p_idempotency_key uuid DEFAULT NULL,
  p_contract_version text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _actor uuid:=auth.uid(); _cached jsonb; _row RECORD; _tenant uuid; _prev uuid; _staff_tenant uuid;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    _cached:=public._crm_idem_check(p_idempotency_key::text,_actor,'crm_assign_clinician');
    IF _cached IS NOT NULL THEN RETURN _cached; END IF;
  END IF;
  BEGIN
    SELECT * INTO _row FROM public._crm_authorize_client_write(p_client_id, p_concurrency_token);
  EXCEPTION
    WHEN sqlstate '42501' THEN RETURN jsonb_build_object('ok',false,'error_code','unauthorized');
    WHEN sqlstate '40001' THEN RETURN jsonb_build_object('ok',false,'error_code','concurrency_conflict');
  END;
  _tenant:=_row.tenant_id; _prev:=_row.current_therapist;

  SELECT tenant_id INTO _staff_tenant FROM public.staff WHERE id=p_staff_id;
  IF _staff_tenant IS NULL OR _staff_tenant <> _tenant THEN
    RETURN jsonb_build_object('ok',false,'error_code','invalid_transition','message','staff_not_in_tenant');
  END IF;

  UPDATE public.clients SET primary_staff_id=p_staff_id, updated_at=now() WHERE id=p_client_id;
  INSERT INTO public.crm_activity_events(tenant_id,client_id,event_type,old_value,new_value,metadata,created_by_profile_id)
  VALUES (_tenant,p_client_id,'clinician_assigned',_prev::text,p_staff_id::text,
          jsonb_build_object('reason',p_reason,'correlation_id',p_idempotency_key), _actor);
  PERFORM public._crm_bump_token(p_client_id,_tenant);
  IF p_idempotency_key IS NOT NULL THEN PERFORM public._crm_idem_store(p_idempotency_key::text,_actor,'crm_assign_clinician',jsonb_build_object('ok',true)); END IF;
  RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.crm_assign_clinician(uuid,uuid,text,text,uuid,text) FROM PUBLIC,anon;
GRANT  EXECUTE ON FUNCTION public.crm_assign_clinician(uuid,uuid,text,text,uuid,text) TO authenticated,service_role;

-- ============================================================
-- A1.9a  crm_close_client
-- ============================================================
CREATE OR REPLACE FUNCTION public.crm_close_client(
  p_client_id uuid, p_disposition_reason text, p_reason text,
  p_concurrency_token text DEFAULT 'auto',
  p_idempotency_key uuid DEFAULT NULL,
  p_contract_version text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _actor uuid:=auth.uid(); _cached jsonb; _row RECORD; _tenant uuid; _cur public.client_lifecycle_stage_enum; _closure public.client_closure_reason_enum;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    _cached:=public._crm_idem_check(p_idempotency_key::text,_actor,'crm_close_client');
    IF _cached IS NOT NULL THEN RETURN _cached; END IF;
  END IF;
  BEGIN
    SELECT * INTO _row FROM public._crm_authorize_client_write(p_client_id, p_concurrency_token);
  EXCEPTION
    WHEN sqlstate '42501' THEN RETURN jsonb_build_object('ok',false,'error_code','unauthorized');
    WHEN sqlstate '40001' THEN RETURN jsonb_build_object('ok',false,'error_code','concurrency_conflict');
  END;
  _tenant:=_row.tenant_id; _cur:=_row.current_lifecycle;
  _closure:=public._crm_closure_from_label(p_disposition_reason);
  IF _closure IS NULL THEN RETURN jsonb_build_object('ok',false,'error_code','invalid_transition','message','unknown_disposition_reason'); END IF;

  UPDATE public.clients SET
    lifecycle_stage='closed'::public.client_lifecycle_stage_enum,
    lifecycle_stage_changed_at=now(),
    closure_reason=_closure, closed_at=now(), updated_at=now()
  WHERE id=p_client_id;

  PERFORM public._crm_emit_state_change(_tenant,p_client_id,'lifecycle_stage'::public.client_state_dimension_enum,
    _cur::text,'closed',p_reason,p_disposition_reason,_actor,p_idempotency_key,'closed');
  PERFORM public._crm_bump_token(p_client_id,_tenant);
  IF p_idempotency_key IS NOT NULL THEN PERFORM public._crm_idem_store(p_idempotency_key::text,_actor,'crm_close_client',jsonb_build_object('ok',true)); END IF;
  RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.crm_close_client(uuid,text,text,text,uuid,text) FROM PUBLIC,anon;
GRANT  EXECUTE ON FUNCTION public.crm_close_client(uuid,text,text,text,uuid,text) TO authenticated,service_role;

-- ============================================================
-- A1.9b  crm_reopen_client
-- ============================================================
CREATE OR REPLACE FUNCTION public.crm_reopen_client(
  p_client_id uuid, p_reason text,
  p_concurrency_token text DEFAULT 'auto',
  p_idempotency_key uuid DEFAULT NULL,
  p_contract_version text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _actor uuid:=auth.uid(); _cached jsonb; _row RECORD; _tenant uuid; _cur public.client_lifecycle_stage_enum;
  _prior public.client_lifecycle_stage_enum;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    _cached:=public._crm_idem_check(p_idempotency_key::text,_actor,'crm_reopen_client');
    IF _cached IS NOT NULL THEN RETURN _cached; END IF;
  END IF;
  BEGIN
    SELECT * INTO _row FROM public._crm_authorize_client_write(p_client_id, p_concurrency_token);
  EXCEPTION
    WHEN sqlstate '42501' THEN RETURN jsonb_build_object('ok',false,'error_code','unauthorized');
    WHEN sqlstate '40001' THEN RETURN jsonb_build_object('ok',false,'error_code','concurrency_conflict');
  END;
  _tenant:=_row.tenant_id; _cur:=_row.current_lifecycle;
  IF _cur <> 'closed'::public.client_lifecycle_stage_enum THEN
    RETURN jsonb_build_object('ok',false,'error_code','invalid_transition','message','client_not_closed');
  END IF;

  SELECT from_value::public.client_lifecycle_stage_enum INTO _prior
  FROM public.crm_client_state_audit
  WHERE client_id=p_client_id AND dimension='lifecycle_stage'::public.client_state_dimension_enum
    AND to_value='closed'
  ORDER BY created_at DESC LIMIT 1;

  IF _prior IS NULL OR _prior='closed'::public.client_lifecycle_stage_enum THEN
    _prior := 'registration'::public.client_lifecycle_stage_enum;
  END IF;

  UPDATE public.clients SET
    lifecycle_stage=_prior, lifecycle_stage_changed_at=now(),
    closure_reason=NULL, closed_at=NULL, updated_at=now()
  WHERE id=p_client_id;

  PERFORM public._crm_emit_state_change(_tenant,p_client_id,'lifecycle_stage'::public.client_state_dimension_enum,
    'closed',_prior::text,p_reason,NULL,_actor,p_idempotency_key,'reopened');
  PERFORM public._crm_bump_token(p_client_id,_tenant);
  IF p_idempotency_key IS NOT NULL THEN PERFORM public._crm_idem_store(p_idempotency_key::text,_actor,'crm_reopen_client',jsonb_build_object('ok',true)); END IF;
  RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.crm_reopen_client(uuid,text,text,uuid,text) FROM PUBLIC,anon;
GRANT  EXECUTE ON FUNCTION public.crm_reopen_client(uuid,text,text,uuid,text) TO authenticated,service_role;

-- ============================================================
-- A1.10  crm_evaluate_communication_policy
-- ============================================================
CREATE OR REPLACE FUNCTION public.crm_evaluate_communication_policy(
  p_client_id uuid, p_channel text, p_message_class text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _actor uuid := auth.uid();
  _c RECORD;
  _authorized boolean;
  _ordinary boolean := p_message_class IN ('ordinary_promotional','ordinary_campaign_follow_up','wait_path_ordinary');
  _closed_blocked boolean := p_message_class IN ('ordinary_promotional','ordinary_campaign_follow_up','wait_path_ordinary','active_care');
  _pv text;
BEGIN
  SELECT c.tenant_id, c.contact_policy, c.service_policy, c.lifecycle_stage, c.contract_version
    INTO _c
  FROM public.clients c WHERE c.id=p_client_id;

  IF _c IS NULL THEN
    RETURN jsonb_build_object('allowed',false,'reason_code','unknown_canonical_state',
      'policy_version','unknown','contact_policy',NULL,'service_policy',NULL);
  END IF;

  -- Caller must be authenticated + tenant member for anything except service_role.
  IF _actor IS NULL THEN
    -- service_role invocations from edge functions: allow
    NULL;
  ELSE
    _authorized := public.crm_has_role(_actor,ARRAY['admin','staff'],_c.tenant_id);
    IF NOT _authorized THEN
      RETURN jsonb_build_object('allowed',false,'reason_code','unknown_canonical_state',
        'policy_version','unknown','contact_policy',NULL,'service_policy',NULL);
    END IF;
  END IF;

  _pv := COALESCE(_c.contract_version::text,'unknown');

  IF _c.service_policy = 'service_blocked'::public.client_service_policy_enum THEN
    RETURN jsonb_build_object('allowed',false,'reason_code','service_policy_blocked',
      'policy_version',_pv,
      'contact_policy',public._crm_contact_policy_to_label(_c.contact_policy),
      'service_policy',public._crm_service_policy_to_label(_c.service_policy));
  END IF;

  IF _c.contact_policy = 'do_not_contact'::public.client_contact_policy_enum AND _ordinary THEN
    RETURN jsonb_build_object('allowed',false,'reason_code','contact_policy_dnc',
      'policy_version',_pv,
      'contact_policy',public._crm_contact_policy_to_label(_c.contact_policy),
      'service_policy',public._crm_service_policy_to_label(_c.service_policy));
  END IF;

  IF _c.lifecycle_stage='closed'::public.client_lifecycle_stage_enum AND _closed_blocked THEN
    RETURN jsonb_build_object('allowed',false,'reason_code','lifecycle_closed_no_active_care',
      'policy_version',_pv,
      'contact_policy',public._crm_contact_policy_to_label(_c.contact_policy),
      'service_policy',public._crm_service_policy_to_label(_c.service_policy));
  END IF;

  IF p_message_class NOT IN (
    'ordinary_promotional','ordinary_campaign_follow_up','wait_path_ordinary',
    'necessary_scheduling','active_care','billing_insurance','clinical_safety_legal','transactional_account'
  ) THEN
    RETURN jsonb_build_object('allowed',false,'reason_code','class_never_permitted',
      'policy_version',_pv,
      'contact_policy',public._crm_contact_policy_to_label(_c.contact_policy),
      'service_policy',public._crm_service_policy_to_label(_c.service_policy));
  END IF;

  RETURN jsonb_build_object('allowed',true,'reason_code','ok',
    'policy_version',_pv,
    'contact_policy',public._crm_contact_policy_to_label(_c.contact_policy),
    'service_policy',public._crm_service_policy_to_label(_c.service_policy));
END $$;
REVOKE ALL ON FUNCTION public.crm_evaluate_communication_policy(uuid,text,text) FROM PUBLIC,anon;
GRANT  EXECUTE ON FUNCTION public.crm_evaluate_communication_policy(uuid,text,text) TO authenticated,service_role;
