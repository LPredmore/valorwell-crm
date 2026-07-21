alter table public.provider_applicants
  add column if not exists recruiting_lifecycle text,
  add column if not exists recruiting_lifecycle_changed_at timestamptz;

comment on column public.provider_applicants.recruiting_lifecycle is
  'CRM-owned recruiting lifecycle signal. Website clinician-interest accounts begin at invite_sent.';

create or replace function public.provision_website_clinician_interest(
  p_auth_user_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_tenant_id uuid := public.website_intake_tenant_id();
  v_first_name text := nullif(trim(p_payload->>'first_name'), '');
  v_last_name text := nullif(trim(p_payload->>'last_name'), '');
  v_email text := lower(nullif(trim(p_payload->>'email'), ''));
  v_submission_key text := nullif(p_payload->>'submission_key', '');
  v_ip_hash text := nullif(p_payload->>'request_ip_hash', '');
  v_contact_id uuid;
  v_applicant_id uuid;
  v_staff_id uuid;
  v_submission_id uuid;
  v_recent_ip_submissions integer := 0;
begin
  if p_auth_user_id is null or v_first_name is null or v_last_name is null or v_email is null then
    raise exception 'required_fields_missing';
  end if;

  if coalesce((p_payload->>'communication_consent')::boolean, false) is not true then
    raise exception 'communication_consent_required';
  end if;

  if v_ip_hash is not null then
    select count(*)
      into v_recent_ip_submissions
      from public.website_submissions ws
     where ws.submission_type = 'clinician_interest'
       and ws.submitted_at >= now() - interval '1 hour'
       and ws.payload->>'request_ip_hash' = v_ip_hash;

    if v_recent_ip_submissions >= 10 then
      raise exception 'rate_limited';
    end if;
  end if;

  insert into public.profiles (
    id,
    email,
    email_verified,
    is_active
  ) values (
    p_auth_user_id,
    v_email,
    true,
    true
  )
  on conflict (id) do update
    set email = excluded.email,
        is_active = true,
        updated_at = now();

  insert into public.user_roles (user_id, role)
  values (p_auth_user_id, 'staff'::public.app_role)
  on conflict (user_id, role) do nothing;

  insert into public.staff (
    tenant_id,
    profile_id,
    prov_name_f,
    prov_name_l,
    prov_status,
    prov_accepting_new_clients
  ) values (
    v_tenant_id,
    p_auth_user_id,
    v_first_name,
    v_last_name,
    'Invited'::public.clinician_status_enum,
    false
  )
  on conflict (profile_id) do update
    set prov_name_f = coalesce(nullif(public.staff.prov_name_f, ''), excluded.prov_name_f),
        prov_name_l = coalesce(nullif(public.staff.prov_name_l, ''), excluded.prov_name_l),
        prov_status = coalesce(public.staff.prov_status, 'Invited'::public.clinician_status_enum),
        updated_at = now()
  returning id into v_staff_id;

  v_contact_id := public.website_upsert_contact(
    p_payload,
    'website_clinician_interest',
    null
  );

  v_applicant_id := public.website_upsert_provider_applicant(
    p_payload,
    v_contact_id,
    'website_clinician_interest',
    null,
    'new'
  );

  update public.provider_applicants
     set profile_id = p_auth_user_id,
         converted_staff_id = v_staff_id,
         recruiting_lifecycle = 'invite_sent',
         recruiting_lifecycle_changed_at = now(),
         application_data = coalesce(application_data, '{}'::jsonb) || jsonb_build_object(
           'communication_consent', true,
           'interest_source', 'website_clinician_interest',
           'account_provisioning_state', 'provisioned',
           'interest_registered_at', now()
         ),
         updated_at = now()
   where id = v_applicant_id;

  insert into public.website_submissions (
    tenant_id,
    submission_type,
    original_lane,
    normalized_lane,
    contact_id,
    provider_applicant_id,
    source_system,
    source_record_key,
    payload,
    consent,
    source_page,
    user_agent,
    status,
    submitted_at
  ) values (
    v_tenant_id,
    'clinician_interest',
    'clinician_interest',
    'provider_recruiting',
    v_contact_id,
    v_applicant_id,
    'website',
    v_submission_key,
    p_payload,
    true,
    coalesce(p_payload->>'source_page', '/clinicians'),
    p_payload->>'user_agent',
    'invite_sent',
    now()
  )
  on conflict (tenant_id, source_system, source_record_key)
    where source_record_key is not null
  do update
    set contact_id = excluded.contact_id,
        provider_applicant_id = excluded.provider_applicant_id,
        payload = excluded.payload,
        consent = excluded.consent,
        status = 'invite_sent',
        updated_at = now()
  returning id into v_submission_id;

  return jsonb_build_object(
    'submission_id', v_submission_id,
    'contact_id', v_contact_id,
    'provider_applicant_id', v_applicant_id,
    'profile_id', p_auth_user_id,
    'staff_id', v_staff_id,
    'recruiting_lifecycle', 'invite_sent',
    'staff_status', 'Invited'
  );
end;
$function$;

revoke all on function public.provision_website_clinician_interest(uuid, jsonb) from public;
revoke all on function public.provision_website_clinician_interest(uuid, jsonb) from anon;
revoke all on function public.provision_website_clinician_interest(uuid, jsonb) from authenticated;
grant execute on function public.provision_website_clinician_interest(uuid, jsonb) to service_role;
