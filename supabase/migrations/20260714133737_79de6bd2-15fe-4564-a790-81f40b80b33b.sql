
-- ============================================================
-- PHASE 1: Canonical foundations for CRM contracts v1
-- - crm_has_role() helper (SECURITY DEFINER, avoids RLS recursion)
-- - v_client_canonical_state view (SECURITY INVOKER, tenant-scoped)
-- - crm_activity_events lockdown (RLS + REVOKE/GRANT)
-- - crm_idempotency_keys hardening
-- Contract version consumed: valorwell-crm-contracts@1.0.0
-- ============================================================

-- ---------- 1. Role helper ----------
CREATE OR REPLACE FUNCTION public.crm_has_role(
  _user_id uuid,
  _roles text[],
  _tenant_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenant_memberships tm
    WHERE tm.profile_id = _user_id
      AND tm.tenant_id  = _tenant_id
      AND tm.tenant_role = ANY(_roles)
  );
$$;

REVOKE ALL ON FUNCTION public.crm_has_role(uuid, text[], uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.crm_has_role(uuid, text[], uuid) TO authenticated, service_role;

-- ---------- 2. Canonical read view ----------
DROP VIEW IF EXISTS public.v_client_canonical_state;

CREATE VIEW public.v_client_canonical_state
WITH (security_invoker = true) AS
SELECT
  c.id                                             AS client_id,
  c.tenant_id                                      AS tenant_id,
  COALESCE(c.contract_version::text, '0')          AS contract_version,
  c.lifecycle_stage::text                          AS lifecycle,
  c.engagement_state::text                         AS engagement,
  jsonb_build_object(
    'at_risk',                    COALESCE(c.at_risk, false),
    'evaluated_at',               COALESCE(c.at_risk_since, c.updated_at),
    'recommended_next_action',    NULL,
    'event_version',              COALESCE(c.contract_version::text, '0')
  )                                                AS at_risk,
  c.eligibility_state::text                        AS eligibility,
  NULL::jsonb                                      AS eligibility_manual_review,
  c.contact_policy::text                           AS contact_policy,
  c.service_policy::text                           AS service_policy,
  c.care_cadence::text                             AS care_cadence,
  c.closure_reason::text                           AS disposition_reason,
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

COMMENT ON VIEW public.v_client_canonical_state IS
  'CRM canonical client-state read model. Contract: valorwell-crm-contracts@1.0.0. '
  'security_invoker=true — respects RLS on underlying tables. Tenant scoped via tenant_memberships.';

-- ---------- 3. crm_activity_events lockdown ----------
ALTER TABLE public.crm_activity_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.crm_activity_events FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON public.crm_activity_events TO authenticated;
GRANT  ALL    ON public.crm_activity_events TO service_role;

-- Drop any pre-existing broad policies so we start from a known state.
DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT policyname FROM pg_policies
    WHERE schemaname='public' AND tablename='crm_activity_events'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.crm_activity_events', p.policyname);
  END LOOP;
END $$;

-- READ: tenant-scoped for authenticated users
CREATE POLICY crm_activity_events_select_tenant
  ON public.crm_activity_events
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tm.tenant_id
      FROM public.tenant_memberships tm
      WHERE tm.profile_id = auth.uid()
    )
  );

-- INSERT: no authenticated policy → PostgREST refuses. service_role bypasses RLS.
-- UPDATE/DELETE: no policies → refused. Rows are append-only.

COMMENT ON TABLE public.crm_activity_events IS
  'CRM activity/audit events. Append-only. Writes only via SECURITY DEFINER RPCs '
  'or service_role edge functions. Reads tenant-scoped via RLS.';

-- ---------- 4. crm_idempotency_keys hardening ----------
-- Table already exists (key, actor_id, operation, result_json, expires_at).
-- Ensure RLS is on and no direct access from clients.
ALTER TABLE public.crm_idempotency_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_idempotency_keys FROM PUBLIC, anon, authenticated;
GRANT  ALL ON public.crm_idempotency_keys TO service_role;
-- No policies for authenticated → no direct access. Only SECURITY DEFINER RPCs use it.

DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT policyname FROM pg_policies
    WHERE schemaname='public' AND tablename='crm_idempotency_keys'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.crm_idempotency_keys', p.policyname);
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS crm_idempotency_keys_expires_at_idx
  ON public.crm_idempotency_keys (expires_at);

COMMENT ON TABLE public.crm_idempotency_keys IS
  'Server-side idempotency store for CRM RPCs. 24h replay window. '
  'Accessed only by SECURITY DEFINER functions; no direct authenticated access.';
