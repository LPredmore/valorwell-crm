-- Phase 1: Server-authoritative CRM operating context (additive, tenant-safe)

-- 1. Capability enum
DO $$ BEGIN
  CREATE TYPE public.crm_capability_role AS ENUM ('crm_admin','crm_operator','crm_readonly','crm_none');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Capability table (additive; does not touch user_roles/tenant_memberships)
CREATE TABLE IF NOT EXISTS public.crm_user_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  crm_role public.crm_capability_role NOT NULL DEFAULT 'crm_operator',
  granted_by uuid NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, tenant_id)
);

GRANT SELECT ON public.crm_user_capabilities TO authenticated;
GRANT ALL    ON public.crm_user_capabilities TO service_role;

ALTER TABLE public.crm_user_capabilities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_user_capabilities_self_select ON public.crm_user_capabilities;
CREATE POLICY crm_user_capabilities_self_select ON public.crm_user_capabilities
  FOR SELECT TO authenticated
  USING (profile_id = auth.uid());

DROP POLICY IF EXISTS crm_user_capabilities_service_all ON public.crm_user_capabilities;
CREATE POLICY crm_user_capabilities_service_all ON public.crm_user_capabilities
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE TRIGGER crm_user_capabilities_touch_updated_at
  BEFORE UPDATE ON public.crm_user_capabilities
  FOR EACH ROW EXECUTE FUNCTION public.crm_touch_updated_at();

-- 3. Seed from existing user_roles + tenant_memberships (idempotent)
INSERT INTO public.crm_user_capabilities (profile_id, tenant_id, crm_role)
SELECT ur.user_id,
       tm.tenant_id,
       CASE WHEN ur.role = 'admin' THEN 'crm_admin'::public.crm_capability_role
            ELSE 'crm_operator'::public.crm_capability_role END
  FROM public.user_roles ur
  JOIN public.tenant_memberships tm ON tm.profile_id = ur.user_id
 WHERE ur.role IN ('admin','staff')
ON CONFLICT (profile_id, tenant_id) DO NOTHING;

-- 4. Operating-context RPC
CREATE OR REPLACE FUNCTION public.get_crm_operating_context()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid            uuid := auth.uid();
  v_available      jsonb;
  v_current        uuid;
  v_role           public.crm_capability_role;
  v_capabilities   jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'authenticated', false,
      'profile_id', null,
      'current_tenant_id', null,
      'available_tenants', '[]'::jsonb,
      'crm_role', 'crm_none',
      'capabilities', jsonb_build_object('mutate',false,'communicate',false,'manage_campaigns',false,'report',false),
      'contract_version', 'valorwell-crm-contracts@1.0.1+20260714'
    );
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'tenant_id', c.tenant_id,
           'crm_role',  c.crm_role
         ) ORDER BY c.tenant_id), '[]'::jsonb)
    INTO v_available
    FROM public.crm_user_capabilities c
   WHERE c.profile_id = v_uid
     AND c.crm_role <> 'crm_none';

  -- Current tenant: only auto-select when exactly one available
  IF jsonb_array_length(v_available) = 1 THEN
    v_current := ((v_available -> 0) ->> 'tenant_id')::uuid;
    v_role    := ((v_available -> 0) ->> 'crm_role')::public.crm_capability_role;
  ELSE
    v_current := NULL;
    v_role    := 'crm_none';
  END IF;

  v_capabilities := CASE v_role
    WHEN 'crm_admin' THEN
      jsonb_build_object('mutate',true,'communicate',true,'manage_campaigns',true,'report',true)
    WHEN 'crm_operator' THEN
      jsonb_build_object('mutate',true,'communicate',true,'manage_campaigns',true,'report',true)
    WHEN 'crm_readonly' THEN
      jsonb_build_object('mutate',false,'communicate',false,'manage_campaigns',false,'report',true)
    ELSE
      jsonb_build_object('mutate',false,'communicate',false,'manage_campaigns',false,'report',false)
  END;

  RETURN jsonb_build_object(
    'authenticated', true,
    'profile_id', v_uid,
    'current_tenant_id', v_current,
    'available_tenants', v_available,
    'crm_role', v_role,
    'capabilities', v_capabilities,
    'contract_version', 'valorwell-crm-contracts@1.0.1+20260714'
  );
END $$;

REVOKE ALL ON FUNCTION public.get_crm_operating_context() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_crm_operating_context() TO authenticated, service_role;

-- 5. Tenant-selection RPC — lets user with >1 tenant pick current (session state
--    lives client-side; the RPC only validates the choice is one of theirs).
CREATE OR REPLACE FUNCTION public.crm_select_operating_tenant(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role public.crm_capability_role;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'UNAUTHENTICATED');
  END IF;
  SELECT crm_role INTO v_role
    FROM public.crm_user_capabilities
   WHERE profile_id = v_uid AND tenant_id = p_tenant_id AND crm_role <> 'crm_none';
  IF v_role IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'NOT_A_MEMBER');
  END IF;
  RETURN jsonb_build_object('ok', true, 'tenant_id', p_tenant_id, 'crm_role', v_role);
END $$;

REVOKE ALL ON FUNCTION public.crm_select_operating_tenant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_select_operating_tenant(uuid) TO authenticated, service_role;