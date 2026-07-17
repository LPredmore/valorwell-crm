
CREATE OR REPLACE FUNCTION public.crm_allowed_lifecycle_transitions(p_client_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_actor uuid := auth.uid();
  v_client public.clients%rowtype;
  v_current public.client_lifecycle_stage_enum;
  v_allowed public.client_lifecycle_stage_enum[];
  v_stage public.client_lifecycle_stage_enum;
  v_all public.client_lifecycle_stage_enum[] := array[
    'registration','intake','matching','matched','scheduled',
    'early_care','established_care','closed'
  ]::public.client_lifecycle_stage_enum[];
  v_result jsonb := '[]'::jsonb;
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'error_code', 'unauthorized');
  end if;

  select * into v_client from public.clients where id = p_client_id;
  if not found then
    return jsonb_build_object('ok', false, 'error_code', 'not_found');
  end if;

  if not public.crm_has_role(v_actor, array['admin','staff'], v_client.tenant_id) then
    return jsonb_build_object('ok', false, 'error_code', 'unauthorized');
  end if;

  v_current := v_client.lifecycle_stage;

  v_allowed := case v_current
    when 'registration' then array['intake','closed']::public.client_lifecycle_stage_enum[]
    when 'intake' then array['registration','matching','closed']::public.client_lifecycle_stage_enum[]
    when 'matching' then array['intake','matched','closed']::public.client_lifecycle_stage_enum[]
    when 'matched' then array['matching','scheduled','closed']::public.client_lifecycle_stage_enum[]
    when 'scheduled' then array['matched','early_care','closed']::public.client_lifecycle_stage_enum[]
    when 'early_care' then array['scheduled','established_care','closed']::public.client_lifecycle_stage_enum[]
    when 'established_care' then array['early_care','closed']::public.client_lifecycle_stage_enum[]
    when 'closed' then array[]::public.client_lifecycle_stage_enum[]
    else array[]::public.client_lifecycle_stage_enum[]
  end;

  foreach v_stage in array v_all loop
    if v_stage = v_current then
      v_result := v_result || jsonb_build_object(
        'stage', v_stage::text, 'allowed', false,
        'reason_code', 'current_stage', 'message', 'Already in this stage'
      );
    elsif v_stage = 'closed' then
      -- closed handled via crm_close_client, not raw transition
      v_result := v_result || jsonb_build_object(
        'stage', v_stage::text, 'allowed', false,
        'reason_code', 'use_close_client',
        'message', 'Use the Close Client action to close a client'
      );
    elsif v_stage = any(v_allowed) then
      v_result := v_result || jsonb_build_object(
        'stage', v_stage::text, 'allowed', true, 'reason_code', null, 'message', null
      );
    else
      v_result := v_result || jsonb_build_object(
        'stage', v_stage::text, 'allowed', false,
        'reason_code', 'not_permitted_from_current',
        'message', format('Cannot transition from %s to %s', v_current, v_stage)
      );
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'current_stage', v_current::text,
    'transitions', v_result
  );
end;
$$;

REVOKE ALL ON FUNCTION public.crm_allowed_lifecycle_transitions(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.crm_allowed_lifecycle_transitions(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_allowed_lifecycle_transitions(uuid) TO service_role;
