create or replace function public.submit_overflow_referral_source(
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_tenant_id uuid := public.website_intake_tenant_id();
  v_practice_name text := nullif(btrim(p_payload->>'practice_name'), '');
  v_primary_contact_name text := nullif(btrim(p_payload->>'primary_contact_name'), '');
  v_email text := lower(nullif(btrim(p_payload->>'email'), ''));
  v_phone text := nullif(btrim(p_payload->>'phone'), '');
  v_source_record_key text := nullif(btrim(p_payload->>'submission_key'), '');
  v_programs text[];
  v_record_id uuid;
  v_status text;
begin
  if nullif(btrim(p_payload->>'company_website'), '') is not null then
    return jsonb_build_object(
      'success', true,
      'status', 'filtered',
      'account_created', false
    );
  end if;

  if v_practice_name is null
     or v_primary_contact_name is null
     or v_email is null
     or v_source_record_key is null then
    raise exception 'required_fields_missing';
  end if;

  if char_length(v_practice_name) > 200
     or char_length(v_primary_contact_name) > 200
     or char_length(v_email) > 255
     or (v_phone is not null and char_length(v_phone) > 40) then
    raise exception 'field_length_invalid';
  end if;

  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'email_invalid';
  end if;

  select coalesce(array_agg(distinct lower(btrim(program))), array[]::text[])
    into v_programs
    from jsonb_array_elements_text(
      coalesce(p_payload->'credentialed_programs', '[]'::jsonb)
    ) as programs(program);

  if cardinality(v_programs) < 1
     or not (v_programs <@ array['champva', 'vaccn', 'tricare']::text[]) then
    raise exception 'credentialed_programs_invalid';
  end if;

  insert into public.overflow_referral_sources (
    tenant_id,
    practice_name,
    primary_contact_name,
    email,
    phone,
    credentialed_programs,
    source,
    source_record_key,
    source_page,
    user_agent,
    status,
    submitted_at
  ) values (
    v_tenant_id,
    v_practice_name,
    v_primary_contact_name,
    v_email,
    v_phone,
    v_programs,
    'website_clinicians',
    v_source_record_key,
    coalesce(nullif(btrim(p_payload->>'source_page'), ''), '/clinicians'),
    nullif(left(p_payload->>'user_agent', 500), ''),
    'new',
    now()
  )
  on conflict (tenant_id, dedupe_key)
  do update set
    practice_name = excluded.practice_name,
    primary_contact_name = excluded.primary_contact_name,
    email = excluded.email,
    phone = excluded.phone,
    credentialed_programs = excluded.credentialed_programs,
    source_record_key = excluded.source_record_key,
    source_page = excluded.source_page,
    user_agent = excluded.user_agent,
    submitted_at = now(),
    status = case
      when public.overflow_referral_sources.status = 'inactive' then 'new'
      else public.overflow_referral_sources.status
    end
  returning id, status into v_record_id, v_status;

  return jsonb_build_object(
    'success', true,
    'record_id', v_record_id,
    'status', v_status,
    'account_created', false
  );
end;
$function$;

revoke all on function public.submit_overflow_referral_source(jsonb) from public;
revoke all on function public.submit_overflow_referral_source(jsonb) from anon;
revoke all on function public.submit_overflow_referral_source(jsonb) from authenticated;
grant execute on function public.submit_overflow_referral_source(jsonb) to anon;
grant execute on function public.submit_overflow_referral_source(jsonb) to authenticated;
