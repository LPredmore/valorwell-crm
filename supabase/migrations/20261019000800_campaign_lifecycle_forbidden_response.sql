-- Forward-only HTTP error classification correction. Missing and foreign targets
-- share the same denial, without exposing whether a foreign enrollment exists.
-- Preserve owner, ACL, VOLATILE and FOR UPDATE scope from 00310.
begin;
create or replace function public._crm_enrollment_tenant_check(p_enrollment_id uuid)
returns public.crm_campaign_enrollments
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_enrollment public.crm_campaign_enrollments;
  v_ctx jsonb;
  v_tenant_id uuid;
begin
  v_ctx := public.get_crm_operating_context();
  v_tenant_id := nullif(v_ctx->>'current_tenant_id','')::uuid;
  if auth.uid() is null or v_tenant_id is null
     or coalesce(v_ctx->>'crm_role','crm_none') not in ('crm_admin','crm_operator')
     or not coalesce((v_ctx->'capabilities'->>'mutate')::boolean,false) then
    raise exception 'permission denied: campaign lifecycle mutation requires an authorized operator' using errcode='42501';
  end if;
  -- Acquire the row before the wrapper checks its state, including different-key
  -- and no-key concurrent actions. Never lock a foreign tenant's enrollment.
  select * into v_enrollment from public.crm_campaign_enrollments
    where id=p_enrollment_id and tenant_id=v_tenant_id for update;
  if not found then raise exception 'enrollment_not_found' using errcode='42501'; end if;
  return v_enrollment;
end;
$$;

commit;
