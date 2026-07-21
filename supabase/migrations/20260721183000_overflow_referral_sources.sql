create table if not exists public.overflow_referral_sources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  practice_name text not null,
  primary_contact_name text not null,
  email text not null,
  phone text,
  credentialed_programs text[] not null,
  status text not null default 'new',
  source text not null default 'website_clinicians',
  source_record_key text not null,
  source_page text not null default '/clinicians',
  user_agent text,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  dedupe_key text generated always as (
    lower(btrim(practice_name)) || '|' || lower(btrim(email))
  ) stored,
  constraint overflow_referral_sources_practice_name_length
    check (char_length(btrim(practice_name)) between 1 and 200),
  constraint overflow_referral_sources_contact_name_length
    check (char_length(btrim(primary_contact_name)) between 1 and 200),
  constraint overflow_referral_sources_email_format
    check (
      char_length(email) <= 255
      and lower(btrim(email)) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    ),
  constraint overflow_referral_sources_phone_length
    check (phone is null or char_length(phone) <= 40),
  constraint overflow_referral_sources_programs_valid
    check (
      cardinality(credentialed_programs) between 1 and 3
      and credentialed_programs <@ array['champva', 'vaccn', 'tricare']::text[]
    ),
  constraint overflow_referral_sources_status_valid
    check (status in ('new', 'reviewing', 'active', 'declined', 'inactive')),
  constraint overflow_referral_sources_source_record_unique
    unique (tenant_id, source_record_key),
  constraint overflow_referral_sources_dedupe_unique
    unique (tenant_id, dedupe_key)
);

comment on table public.overflow_referral_sources is
  'Independent practices that may accept ValorWell overflow referrals. These records do not create ValorWell accounts or staff access.';

comment on column public.overflow_referral_sources.credentialed_programs is
  'Programs the independent practice attests it is fully credentialed to accept: champva, vaccn, and/or tricare.';

alter table public.overflow_referral_sources enable row level security;

revoke all on table public.overflow_referral_sources from public;
revoke all on table public.overflow_referral_sources from anon;
grant select, update on table public.overflow_referral_sources to authenticated;
grant all on table public.overflow_referral_sources to service_role;

drop policy if exists overflow_referral_sources_tenant_select on public.overflow_referral_sources;
create policy overflow_referral_sources_tenant_select
on public.overflow_referral_sources
for select
to authenticated
using (
  public.crm_has_role(
    auth.uid(),
    array['admin'::text, 'staff'::text],
    tenant_id
  )
);

drop policy if exists overflow_referral_sources_tenant_update on public.overflow_referral_sources;
create policy overflow_referral_sources_tenant_update
on public.overflow_referral_sources
for update
to authenticated
using (
  public.crm_has_role(
    auth.uid(),
    array['admin'::text, 'staff'::text],
    tenant_id
  )
)
with check (
  public.crm_has_role(
    auth.uid(),
    array['admin'::text, 'staff'::text],
    tenant_id
  )
);

drop trigger if exists overflow_referral_sources_set_updated_at on public.overflow_referral_sources;
create trigger overflow_referral_sources_set_updated_at
before update on public.overflow_referral_sources
for each row execute function public.set_updated_at();

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
