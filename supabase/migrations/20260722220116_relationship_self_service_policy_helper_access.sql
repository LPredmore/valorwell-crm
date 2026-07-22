revoke all on function public.website_intake_tenant_id() from public;
revoke all on function public.website_intake_tenant_id() from anon;
grant execute on function public.website_intake_tenant_id() to authenticated;

comment on function public.website_intake_tenant_id() is
  'Returns the canonical ValorWell website-intake tenant ID. Authenticated execute is required only because existing profile self-service RLS policies reference this helper; anonymous direct execution remains revoked.';
