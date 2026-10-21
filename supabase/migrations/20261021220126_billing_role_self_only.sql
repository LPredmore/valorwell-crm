CREATE OR REPLACE FUNCTION public.has_billing_role(_user_id uuid,_tenant_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $body$
  SELECT coalesce(auth.uid()=_user_id,false) AND EXISTS (
    SELECT 1 FROM public.staff s
    JOIN public.staff_role_assignments sra ON sra.staff_id=s.id
    JOIN public.staff_roles sr ON sr.id=sra.staff_role_id
    WHERE s.profile_id=_user_id AND s.tenant_id=_tenant_id
      AND sra.tenant_id=_tenant_id
      AND upper(sr.code) IN ('ADMIN','BILLING','ACCOUNT_OWNER')
  );
$body$;
REVOKE ALL ON FUNCTION public.has_billing_role(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.has_billing_role(uuid,uuid) TO authenticated,service_role;
