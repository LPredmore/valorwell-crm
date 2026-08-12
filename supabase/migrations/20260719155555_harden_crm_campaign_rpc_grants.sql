-- CRM campaign actions require an authenticated Billing Hub session.
-- Their internal tenant and role checks remain authoritative.

revoke execute on function public.crm_enroll_clients_in_campaign(uuid, uuid[], text, uuid, text) from public, anon;
revoke execute on function public.crm_pause_enrollment(uuid, text, text) from public, anon;
revoke execute on function public.crm_resume_enrollment(uuid, text, text) from public, anon;
revoke execute on function public.crm_cancel_enrollment(uuid, text, text) from public, anon;
revoke execute on function public.crm_mark_enrollment_responded(uuid, text, text) from public, anon;
revoke execute on function public.crm_restart_enrollment(uuid, text, text) from public, anon;

grant execute on function public.crm_enroll_clients_in_campaign(uuid, uuid[], text, uuid, text) to authenticated, service_role;
grant execute on function public.crm_pause_enrollment(uuid, text, text) to authenticated, service_role;
grant execute on function public.crm_resume_enrollment(uuid, text, text) to authenticated, service_role;
grant execute on function public.crm_cancel_enrollment(uuid, text, text) to authenticated, service_role;
grant execute on function public.crm_mark_enrollment_responded(uuid, text, text) to authenticated, service_role;
grant execute on function public.crm_restart_enrollment(uuid, text, text) to authenticated, service_role;
