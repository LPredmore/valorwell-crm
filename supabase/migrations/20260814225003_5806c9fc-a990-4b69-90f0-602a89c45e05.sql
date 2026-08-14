-- ============ PHASE 11: donor identity ============
create table if not exists public.crm_donors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  person_id uuid references public.crm_people(id) on delete set null,
  relationship_contact_id uuid references public.relationship_contacts(id) on delete set null,
  givebutter_contact_id text,
  display_name text,
  primary_email text,
  first_donation_at timestamptz,
  first_one_time_donation_at timestamptz,
  first_recurring_donation_at timestamptz,
  last_donation_at timestamptz,
  donation_count integer not null default 0,
  lifetime_amount numeric(14,2) not null default 0,
  recurring_status text not null default 'none' check (recurring_status in ('none', 'active', 'lapsed')),
  communication_opt_in boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists crm_donors_person_idx on public.crm_donors (tenant_id, person_id) where person_id is not null;
create unique index if not exists crm_donors_givebutter_idx on public.crm_donors (tenant_id, givebutter_contact_id) where givebutter_contact_id is not null;
create index if not exists crm_donors_tenant_idx on public.crm_donors (tenant_id, last_donation_at desc);

grant select on public.crm_donors to authenticated;
grant all on public.crm_donors to service_role;
alter table public.crm_donors enable row level security;

create table if not exists public.crm_donor_ingest_queue (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  transaction_id text not null,
  status text not null default 'pending' check (status in ('pending', 'processed', 'skipped', 'failed')),
  historical boolean not null default false,
  attempts integer not null default 0,
  last_error text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, transaction_id)
);

create index if not exists crm_donor_ingest_queue_pending_idx on public.crm_donor_ingest_queue (status, created_at) where status = 'pending';

grant select on public.crm_donor_ingest_queue to authenticated;
grant all on public.crm_donor_ingest_queue to service_role;
alter table public.crm_donor_ingest_queue enable row level security;

do $$
declare
  v_table text;
begin
  foreach v_table in array array['crm_donors', 'crm_donor_ingest_queue'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = v_table and policyname = v_table || '_staff_read') then
      execute format($f$
        create policy %I on public.%I for select to authenticated
        using (exists (
          select 1 from public.tenant_memberships m
          where m.profile_id = auth.uid() and m.tenant_id = public.%I.tenant_id
        ))
      $f$, v_table || '_staff_read', v_table, v_table);
    end if;
    execute format('drop trigger if exists %I on public.%I', v_table || '_touch', v_table);
    execute format(
      'create trigger %I before update on public.%I for each row execute function private.crm_touch_updated_at()',
      v_table || '_touch', v_table
    );
  end loop;
end
$$;

create or replace view public.crm_donor_transactions_v as
select
  d.id as donor_id,
  d.tenant_id,
  d.person_id,
  g.transaction_id,
  (g.raw->'data'->>'contact_id') as givebutter_contact_id,
  (g.raw->'data'->>'plan_id') as plan_id,
  coalesce((g.raw->'data'->>'is_recurring')::boolean, false) as is_recurring,
  g.amount,
  g.currency,
  g.donated_at
from public.givebutter_donations g
join public.crm_donors d
  on d.givebutter_contact_id is not distinct from (g.raw->'data'->>'contact_id')
  or (d.primary_email is not null and d.primary_email = lower(btrim(g.raw->'data'->>'email')));

grant select on public.crm_donor_transactions_v to authenticated, service_role;

create or replace function private.crm_process_donor_transaction(
  p_tenant_id uuid,
  p_transaction_id text,
  p_historical boolean
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_row public.givebutter_donations;
  v_data jsonb;
  v_email text;
  v_name text;
  v_contact_id text;
  v_plan_id text;
  v_recurring boolean;
  v_status text;
  v_amount numeric;
  v_donated_at timestamptz;
  v_person_id uuid;
  v_donor public.crm_donors;
  v_is_first_recurring boolean := false;
  v_is_first_one_time boolean := false;
begin
  select * into v_row from public.givebutter_donations where transaction_id = p_transaction_id;
  if v_row.transaction_id is null then
    return jsonb_build_object('outcome', 'skipped', 'reason', 'transaction_not_found');
  end if;

  v_data := coalesce(v_row.raw->'data', '{}'::jsonb);
  v_status := lower(coalesce(v_data->>'status', 'succeeded'));
  if v_status not in ('succeeded', 'success', 'completed', 'paid') then
    return jsonb_build_object('outcome', 'skipped', 'reason', 'transaction_not_successful');
  end if;

  v_email := nullif(lower(btrim(coalesce(v_data->>'email', ''))), '');
  v_contact_id := nullif(btrim(coalesce(v_data->>'contact_id', '')), '');
  v_plan_id := nullif(btrim(coalesce(v_data->>'plan_id', '')), '');
  v_recurring := coalesce((v_data->>'is_recurring')::boolean, false);
  v_amount := coalesce(v_row.amount, (v_data->>'amount')::numeric, 0);
  v_donated_at := coalesce(v_row.donated_at, (v_data->>'transacted_at')::timestamptz, now());
  v_name := nullif(btrim(concat_ws(' ', v_data->>'first_name', v_data->>'last_name')), '');

  if v_email is not null then
    select i.person_id into v_person_id
    from public.crm_person_identities i
    where i.tenant_id = p_tenant_id and i.identity_kind = 'email' and i.identity_value = v_email
    limit 1;

    if v_person_id is null then
      insert into public.crm_people (tenant_id, display_name, primary_email)
      values (p_tenant_id, coalesce(v_name, v_email), v_email)
      returning id into v_person_id;

      insert into public.crm_person_identities (tenant_id, person_id, identity_kind, identity_value)
      values (p_tenant_id, v_person_id, 'email', v_email)
      on conflict (tenant_id, identity_kind, identity_value) do nothing;
    end if;
  end if;

  select * into v_donor
  from public.crm_donors
  where tenant_id = p_tenant_id
    and (
      (v_person_id is not null and person_id = v_person_id)
      or (v_contact_id is not null and givebutter_contact_id = v_contact_id)
    )
  limit 1;

  if v_donor.id is null then
    insert into public.crm_donors (
      tenant_id, person_id, givebutter_contact_id, display_name, primary_email,
      communication_opt_in
    )
    values (
      p_tenant_id, v_person_id, v_contact_id, v_name, v_email,
      coalesce((v_data->>'communication_opt_in')::boolean, false)
    )
    returning * into v_donor;
  end if;

  if v_person_id is not null then
    insert into public.crm_person_records (tenant_id, person_id, record_domain, record_id, match_basis)
    values (p_tenant_id, v_person_id, 'donor', v_donor.id, 'email')
    on conflict (tenant_id, record_domain, record_id) do nothing;
  end if;

  v_is_first_recurring := v_recurring and v_donor.first_recurring_donation_at is null;
  v_is_first_one_time := (not v_recurring) and v_donor.first_one_time_donation_at is null;

  update public.crm_donors
  set person_id = coalesce(person_id, v_person_id),
      givebutter_contact_id = coalesce(givebutter_contact_id, v_contact_id),
      display_name = coalesce(display_name, v_name),
      primary_email = coalesce(primary_email, v_email),
      first_donation_at = least(coalesce(first_donation_at, v_donated_at), v_donated_at),
      first_one_time_donation_at = case
        when v_recurring then first_one_time_donation_at
        else least(coalesce(first_one_time_donation_at, v_donated_at), v_donated_at) end,
      first_recurring_donation_at = case
        when v_recurring then least(coalesce(first_recurring_donation_at, v_donated_at), v_donated_at)
        else first_recurring_donation_at end,
      last_donation_at = greatest(coalesce(last_donation_at, v_donated_at), v_donated_at),
      donation_count = donation_count + 1,
      lifetime_amount = lifetime_amount + v_amount,
      recurring_status = case when v_recurring then 'active' else recurring_status end,
      communication_opt_in = communication_opt_in or coalesce((v_data->>'communication_opt_in')::boolean, false),
      updated_at = now()
  where id = v_donor.id;

  perform public.crm_emit_automation_event(
    p_tenant_id, 'donor.donation_received', 'donor', v_donor.id,
    'donor:donation_received:' || p_transaction_id,
    jsonb_build_object(
      'transactionId', p_transaction_id, 'donorId', v_donor.id, 'personId', v_person_id,
      'givebutterContactId', v_contact_id, 'planId', v_plan_id, 'recurring', v_recurring,
      'amount', v_amount, 'historical', p_historical, 'suppress_campaign_trigger', p_historical
    ),
    'givebutter', null, v_donated_at
  );

  if v_is_first_one_time then
    perform public.crm_emit_automation_event(
      p_tenant_id, 'donor.first_one_time_donation', 'donor', v_donor.id,
      'donor:first_one_time:' || v_donor.id::text,
      jsonb_build_object('transactionId', p_transaction_id, 'donorId', v_donor.id, 'personId', v_person_id,
        'amount', v_amount, 'historical', p_historical, 'suppress_campaign_trigger', p_historical),
      'givebutter', null, v_donated_at
    );
  end if;

  if v_is_first_recurring then
    perform public.crm_emit_automation_event(
      p_tenant_id, 'donor.first_recurring_donation', 'donor', v_donor.id,
      'donor:first_recurring:' || v_donor.id::text,
      jsonb_build_object('transactionId', p_transaction_id, 'donorId', v_donor.id, 'personId', v_person_id,
        'planId', v_plan_id, 'amount', v_amount, 'historical', p_historical, 'suppress_campaign_trigger', p_historical),
      'givebutter', null, v_donated_at
    );
  end if;

  return jsonb_build_object(
    'outcome', 'processed', 'donorId', v_donor.id, 'personId', v_person_id,
    'firstOneTime', v_is_first_one_time, 'firstRecurring', v_is_first_recurring
  );
end;
$$;

create or replace function public.crm_enqueue_donor_transactions(
  p_reason text,
  p_historical boolean default true,
  p_limit integer default 5000
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_context jsonb := private.relationship_campaign_context(true);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
  v_profile uuid := (v_context->>'actor_id')::uuid;
  v_added integer;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A reason is required to queue donations for processing';
  end if;

  with queued as (
    insert into public.crm_donor_ingest_queue (tenant_id, transaction_id, historical)
    select v_tenant, g.transaction_id, p_historical
    from public.givebutter_donations g
    order by g.donated_at
    limit greatest(coalesce(p_limit, 5000), 1)
    on conflict (tenant_id, transaction_id) do nothing
    returning 1
  )
  select count(*) into v_added from queued;

  insert into public.crm_activity_events (tenant_id, event_type, created_by_profile_id, metadata)
  values (v_tenant, 'donor_queue_filled', v_profile,
    jsonb_build_object('queued', v_added, 'historical', p_historical, 'reason', btrim(p_reason)));

  return jsonb_build_object('queued', v_added, 'historical', p_historical);
end;
$$;

create or replace function public.crm_process_donor_queue(
  p_reason text,
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_context jsonb := private.relationship_campaign_context(true);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
  v_profile uuid := (v_context->>'actor_id')::uuid;
  v_item public.crm_donor_ingest_queue;
  v_result jsonb;
  v_processed integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A reason is required to process the donor queue';
  end if;

  for v_item in
    select * from public.crm_donor_ingest_queue
    where tenant_id = v_tenant and status = 'pending'
    order by created_at
    limit greatest(coalesce(p_limit, 100), 1)
    for update skip locked
  loop
    begin
      v_result := private.crm_process_donor_transaction(v_tenant, v_item.transaction_id, v_item.historical);
      update public.crm_donor_ingest_queue
      set status = case when v_result->>'outcome' = 'processed' then 'processed' else 'skipped' end,
          attempts = attempts + 1,
          last_error = null,
          processed_at = now(),
          updated_at = now()
      where id = v_item.id;

      if v_result->>'outcome' = 'processed' then
        v_processed := v_processed + 1;
      else
        v_skipped := v_skipped + 1;
      end if;
    exception when others then
      update public.crm_donor_ingest_queue
      set status = 'failed', attempts = attempts + 1, last_error = sqlerrm, updated_at = now()
      where id = v_item.id;
      v_failed := v_failed + 1;
    end;
  end loop;

  insert into public.crm_activity_events (tenant_id, event_type, created_by_profile_id, metadata)
  values (v_tenant, 'donor_queue_processed', v_profile,
    jsonb_build_object('processed', v_processed, 'skipped', v_skipped, 'failed', v_failed, 'reason', btrim(p_reason)));

  return jsonb_build_object('processed', v_processed, 'skipped', v_skipped, 'failed', v_failed);
end;
$$;

create or replace function public.crm_donor_overview()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_context jsonb := private.relationship_campaign_context(false);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
begin
  return jsonb_build_object(
    'donors', (select count(*) from public.crm_donors where tenant_id = v_tenant),
    'recurringDonors', (select count(*) from public.crm_donors where tenant_id = v_tenant and recurring_status = 'active'),
    'lifetimeAmount', coalesce((select sum(lifetime_amount) from public.crm_donors where tenant_id = v_tenant), 0),
    'queuePending', (select count(*) from public.crm_donor_ingest_queue where tenant_id = v_tenant and status = 'pending'),
    'queueFailed', (select count(*) from public.crm_donor_ingest_queue where tenant_id = v_tenant and status = 'failed'),
    'totalDonations', (select count(*) from public.givebutter_donations)
  );
end;
$$;

-- ============ PHASE 12: donor campaigns on the relationship engine ============
alter table public.relationship_campaigns
  add column if not exists audience_domain text not null default 'bty';

alter table public.relationship_campaigns
  drop constraint if exists relationship_campaigns_audience_domain_check;
alter table public.relationship_campaigns
  add constraint relationship_campaigns_audience_domain_check
  check (audience_domain in ('bty', 'donor', 'general'));

alter table public.relationship_campaign_enrollments
  add column if not exists audience_domain text not null default 'bty';
alter table public.relationship_campaign_enrollments
  add column if not exists donor_id uuid references public.crm_donors(id) on delete set null;

alter table public.relationship_campaign_enrollments
  drop constraint if exists relationship_campaign_enrollments_audience_domain_check;
alter table public.relationship_campaign_enrollments
  add constraint relationship_campaign_enrollments_audience_domain_check
  check (audience_domain in ('bty', 'donor', 'general'));

create index if not exists relationship_campaign_enrollments_audience_idx
  on public.relationship_campaign_enrollments (tenant_id, audience_domain, status);

create or replace function private.relationship_enrollment_audience_default()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_domain text;
begin
  select audience_domain into v_domain from public.relationship_campaigns where id = new.campaign_id;
  new.audience_domain := coalesce(v_domain, new.audience_domain, 'bty');
  return new;
end;
$$;

drop trigger if exists relationship_enrollment_audience_default on public.relationship_campaign_enrollments;
create trigger relationship_enrollment_audience_default
before insert on public.relationship_campaign_enrollments
for each row execute function private.relationship_enrollment_audience_default();

create or replace function public.crm_sync_relationship_campaign_registry()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.crm_campaign_registry
    where engine = 'relationship_campaigns' and source_campaign_id = old.id;
    return old;
  end if;

  insert into public.crm_campaign_registry (
    tenant_id, campaign_domain, engine, source_campaign_id, name, status, is_active, metadata
  )
  values (
    new.tenant_id,
    case when coalesce(new.audience_domain, 'bty') = 'donor' then 'donor' else 'relationship' end,
    'relationship_campaigns', new.id, new.name,
    coalesce(new.status, 'unknown'),
    coalesce(new.execution_enabled, false) and coalesce(new.status, '') = 'active',
    jsonb_strip_nulls(jsonb_build_object(
      'purpose', new.purpose, 'initiative', new.initiative, 'audienceDomain', new.audience_domain))
  )
  on conflict (tenant_id, engine, source_campaign_id)
  do update set name = excluded.name,
                campaign_domain = excluded.campaign_domain,
                status = excluded.status,
                is_active = excluded.is_active,
                metadata = excluded.metadata,
                updated_at = now();
  return new;
end;
$$;

update public.relationship_campaigns set updated_at = updated_at;

-- ============ PHASE 13: Beyond The Yellow outreach state ============
create table if not exists public.crm_bty_outreach_states (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  opportunity_id uuid references public.relationship_opportunities(id) on delete cascade,
  contact_id uuid references public.relationship_contacts(id) on delete cascade,
  outreach_state text not null default 'recommended'
    check (outreach_state in ('recommended', 'ready', 'contacted', 'responded', 'interested', 'cold', 'do_not_contact')),
  previous_state text,
  reason text,
  changed_by_profile_id uuid,
  changed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (opportunity_id is not null or contact_id is not null)
);

create unique index if not exists crm_bty_outreach_states_opportunity_idx
  on public.crm_bty_outreach_states (tenant_id, opportunity_id) where opportunity_id is not null;
create unique index if not exists crm_bty_outreach_states_contact_idx
  on public.crm_bty_outreach_states (tenant_id, contact_id) where opportunity_id is null and contact_id is not null;

create table if not exists public.crm_bty_outreach_state_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  outreach_state_id uuid not null references public.crm_bty_outreach_states(id) on delete cascade,
  from_state text,
  to_state text not null,
  reason text not null,
  changed_by_profile_id uuid,
  created_at timestamptz not null default now()
);

grant select on public.crm_bty_outreach_states to authenticated;
grant select on public.crm_bty_outreach_state_history to authenticated;
grant all on public.crm_bty_outreach_states to service_role;
grant all on public.crm_bty_outreach_state_history to service_role;

alter table public.crm_bty_outreach_states enable row level security;
alter table public.crm_bty_outreach_state_history enable row level security;

do $$
declare
  v_table text;
begin
  foreach v_table in array array['crm_bty_outreach_states', 'crm_bty_outreach_state_history'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = v_table and policyname = v_table || '_staff_read') then
      execute format($f$
        create policy %I on public.%I for select to authenticated
        using (exists (
          select 1 from public.tenant_memberships m
          where m.profile_id = auth.uid() and m.tenant_id = public.%I.tenant_id
        ))
      $f$, v_table || '_staff_read', v_table, v_table);
    end if;
  end loop;
  execute 'drop trigger if exists crm_bty_outreach_states_touch on public.crm_bty_outreach_states';
  execute 'create trigger crm_bty_outreach_states_touch before update on public.crm_bty_outreach_states for each row execute function private.crm_touch_updated_at()';
end
$$;

create or replace function public.crm_set_bty_outreach_state(
  p_opportunity_id uuid,
  p_contact_id uuid,
  p_state text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_context jsonb := private.relationship_campaign_context(true);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
  v_profile uuid := (v_context->>'actor_id')::uuid;
  v_contact uuid := p_contact_id;
  v_row public.crm_bty_outreach_states;
  v_previous text;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A reason is required to change the outreach state';
  end if;
  if p_state not in ('recommended', 'ready', 'contacted', 'responded', 'interested', 'cold', 'do_not_contact') then
    raise exception 'Unsupported outreach state: %', p_state;
  end if;
  if p_opportunity_id is null and p_contact_id is null then
    raise exception 'An opportunity or a contact is required';
  end if;

  if p_opportunity_id is not null then
    select o.primary_contact_id into v_contact
    from public.relationship_opportunities o
    where o.id = p_opportunity_id and o.tenant_id = v_tenant;
    if not found then
      raise exception 'Opportunity not found for this tenant';
    end if;
    v_contact := coalesce(p_contact_id, v_contact);
  end if;

  select * into v_row
  from public.crm_bty_outreach_states
  where tenant_id = v_tenant
    and ((p_opportunity_id is not null and opportunity_id = p_opportunity_id)
      or (p_opportunity_id is null and contact_id = p_contact_id));

  v_previous := v_row.outreach_state;

  if v_row.id is null then
    insert into public.crm_bty_outreach_states (
      tenant_id, opportunity_id, contact_id, outreach_state, previous_state, reason, changed_by_profile_id
    )
    values (v_tenant, p_opportunity_id, v_contact, p_state, null, btrim(p_reason), v_profile)
    returning * into v_row;
  else
    update public.crm_bty_outreach_states
    set outreach_state = p_state,
        previous_state = v_previous,
        contact_id = coalesce(v_contact, contact_id),
        reason = btrim(p_reason),
        changed_by_profile_id = v_profile,
        changed_at = now()
    where id = v_row.id
    returning * into v_row;
  end if;

  insert into public.crm_bty_outreach_state_history (
    tenant_id, outreach_state_id, from_state, to_state, reason, changed_by_profile_id
  )
  values (v_tenant, v_row.id, v_previous, p_state, btrim(p_reason), v_profile);

  if p_state = 'do_not_contact' and v_contact is not null then
    update public.relationship_contacts
    set do_not_contact = true, updated_at = now()
    where id = v_contact and tenant_id = v_tenant;

    perform public.apply_relationship_suppression(
      jsonb_build_object(
        'scope', 'contact',
        'reason', 'do_not_contact',
        'contactId', v_contact,
        'source', 'crm_manual',
        'metadata', jsonb_build_object('origin', 'bty_outreach_state', 'note', btrim(p_reason))
      ),
      'bty-dnc:' || v_contact::text || ':' || v_row.id::text
    );
  end if;

  perform public.crm_emit_automation_event(
    v_tenant, 'bty.' || p_state, 'relationship_contact', v_contact,
    'bty:state:' || v_row.id::text || ':' || p_state || ':' || extract(epoch from now())::bigint::text,
    jsonb_build_object('outreachStateId', v_row.id, 'opportunityId', p_opportunity_id, 'contactId', v_contact,
      'fromState', v_previous, 'toState', p_state, 'reason', btrim(p_reason)),
    'crm', null, now()
  );

  return jsonb_build_object('outreachStateId', v_row.id, 'state', p_state, 'previousState', v_previous);
end;
$$;

create or replace function public.crm_list_bty_outreach_states(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_context jsonb := private.relationship_campaign_context(false);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id,
      'opportunityId', s.opportunity_id,
      'contactId', s.contact_id,
      'contactName', nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''),
      'state', s.outreach_state,
      'previousState', s.previous_state,
      'reason', s.reason,
      'changedAt', s.changed_at
    ) order by s.changed_at desc)
    from (
      select * from public.crm_bty_outreach_states
      where tenant_id = v_tenant
      order by changed_at desc
      limit greatest(coalesce(p_limit, 200), 1)
    ) s
    left join public.relationship_contacts c on c.id = s.contact_id
  ), '[]'::jsonb);
end;
$$;

-- ============ PHASE 14: relationship enrolment through the trigger engine ============
create or replace function public.crm_execute_campaign_trigger_job(p_job_id uuid, p_claim_token uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_job public.crm_campaign_trigger_jobs;
  v_rule public.crm_campaign_trigger_rules;
  v_registry public.crm_campaign_registry;
  v_client public.clients;
  v_current text;
  v_expected text;
  v_concurrency jsonb;
  v_shadow boolean;
  v_enrollment_id uuid;
  v_first_step record;
  v_scheduled timestamptz;
  v_result jsonb;
  v_event public.crm_automation_events;
  v_contact public.relationship_contacts;
  v_campaign public.relationship_campaigns;
begin
  select * into v_job from public.crm_campaign_trigger_jobs
  where id = p_job_id and claim_token = p_claim_token and status = 'processing'
  for update;

  if v_job.id is null then
    return jsonb_build_object('ok', false, 'error_code', 'job_not_claimed');
  end if;

  select * into v_rule from public.crm_campaign_trigger_rules where id = v_job.trigger_rule_id;
  select * into v_registry from public.crm_campaign_registry where id = v_rule.campaign_registry_id;
  select * into v_event from public.crm_automation_events where id = v_job.event_id;

  -- rule / campaign must still be live
  if v_rule.id is null or not v_rule.active or v_registry.id is null or not v_registry.is_active then
    update public.crm_campaign_trigger_jobs
    set status = 'skipped', skip_reason = 'campaign_or_rule_inactive', updated_at = now()
    where id = v_job.id;
    return jsonb_build_object('ok', true, 'outcome', 'skipped', 'skipReason', 'campaign_or_rule_inactive');
  end if;

  -- historical backfill events must never produce live outreach
  if coalesce((v_event.payload->>'suppress_campaign_trigger')::boolean, false) then
    update public.crm_campaign_trigger_jobs
    set status = 'skipped', skip_reason = 'historical_backfill', updated_at = now()
    where id = v_job.id;
    return jsonb_build_object('ok', true, 'outcome', 'skipped', 'skipReason', 'historical_backfill');
  end if;

  -- ---------- relationship engine (Beyond The Yellow and donor campaigns) ----------
  if v_registry.engine = 'relationship_campaigns' then
    v_shadow := not private.crm_control_plane_flag(v_job.tenant_id, 'bty_trigger_cutover_enabled');

    select * into v_campaign from public.relationship_campaigns
    where id = v_registry.source_campaign_id and tenant_id = v_job.tenant_id;

    if v_campaign.id is null then
      update public.crm_campaign_trigger_jobs
      set status = 'skipped', skip_reason = 'campaign_missing', updated_at = now()
      where id = v_job.id;
      return jsonb_build_object('ok', true, 'outcome', 'skipped', 'skipReason', 'campaign_missing');
    end if;

    if coalesce(v_campaign.audience_domain, 'bty') = 'donor'
       and not private.crm_control_plane_flag(v_job.tenant_id, 'donor_campaigns_enabled') then
      update public.crm_campaign_trigger_jobs
      set status = 'skipped', skip_reason = 'donor_campaigns_disabled', updated_at = now()
      where id = v_job.id;
      return jsonb_build_object('ok', true, 'outcome', 'skipped', 'skipReason', 'donor_campaigns_disabled');
    end if;

    select * into v_contact from public.relationship_contacts
    where tenant_id = v_job.tenant_id
      and id = coalesce(
        case when v_job.subject_type = 'relationship_contact' then v_job.subject_id end,
        nullif(v_event.payload->>'contactId', '')::uuid
      );

    if v_contact.id is null then
      update public.crm_campaign_trigger_jobs
      set status = 'skipped', skip_reason = 'subject_missing', updated_at = now()
      where id = v_job.id;
      return jsonb_build_object('ok', true, 'outcome', 'skipped', 'skipReason', 'subject_missing');
    end if;

    if coalesce(v_contact.do_not_contact, false) or nullif(btrim(coalesce(v_contact.email, '')), '') is null then
      update public.crm_campaign_trigger_jobs
      set status = 'skipped',
          skip_reason = case when coalesce(v_contact.do_not_contact, false) then 'do_not_contact' else 'no_email' end,
          updated_at = now()
      where id = v_job.id;
      return jsonb_build_object('ok', true, 'outcome', 'skipped',
        'skipReason', case when coalesce(v_contact.do_not_contact, false) then 'do_not_contact' else 'no_email' end);
    end if;

    if exists (
      select 1 from public.relationship_campaign_enrollments e
      where e.tenant_id = v_job.tenant_id
        and e.campaign_id = v_campaign.id
        and e.contact_id = v_contact.id
    ) then
      update public.crm_campaign_trigger_jobs
      set status = 'skipped', skip_reason = 'already_participated', updated_at = now()
      where id = v_job.id;
      return jsonb_build_object('ok', true, 'outcome', 'skipped', 'skipReason', 'already_participated');
    end if;

    v_concurrency := public.crm_evaluate_campaign_concurrency(
      v_job.tenant_id, v_registry.id, 'relationship_contact', v_contact.id
    );

    if not coalesce((v_concurrency->>'allowed')::boolean, false) then
      update public.crm_campaign_trigger_jobs
      set status = 'skipped', skip_reason = coalesce(v_concurrency->>'reason', 'concurrency_blocked'),
          evaluation_result = v_job.evaluation_result || jsonb_build_object('concurrency', v_concurrency),
          updated_at = now()
      where id = v_job.id;
      return jsonb_build_object('ok', true, 'outcome', 'skipped', 'skipReason', coalesce(v_concurrency->>'reason', 'concurrency_blocked'));
    end if;

    if v_shadow then
      update public.crm_campaign_trigger_jobs
      set status = 'skipped', skip_reason = 'shadow_mode',
          evaluation_result = v_job.evaluation_result || jsonb_build_object(
            'shadow', true, 'wouldEnroll', true, 'engine', 'relationship_campaigns',
            'campaignRegistryId', v_registry.id, 'sourceCampaignId', v_registry.source_campaign_id,
            'contactId', v_contact.id, 'evaluatedAt', now()),
          updated_at = now()
      where id = v_job.id;
      return jsonb_build_object('ok', true, 'outcome', 'shadow_would_enroll', 'campaignRegistryId', v_registry.id);
    end if;

    insert into public.relationship_campaign_enrollments (
      tenant_id, campaign_id, contact_id, organization_id, recipient_email, recipient_name,
      status, current_step_position, audience_domain, metadata
    )
    values (
      v_job.tenant_id, v_campaign.id, v_contact.id, null,
      lower(btrim(v_contact.email)),
      nullif(btrim(concat_ws(' ', v_contact.first_name, v_contact.last_name)), ''),
      'active', 0, coalesce(v_campaign.audience_domain, 'bty'),
      jsonb_build_object('enrolledBy', 'campaign_trigger_engine', 'triggerRuleId', v_rule.id, 'eventId', v_job.event_id)
    )
    returning id into v_enrollment_id;

    update public.crm_campaign_trigger_jobs
    set status = 'enrolled', engine_enrollment_id = v_enrollment_id,
        evaluation_result = v_job.evaluation_result || jsonb_build_object('enrolledAt', now(), 'engine', 'relationship_campaigns', 'concurrency', v_concurrency),
        updated_at = now()
    where id = v_job.id;

    return jsonb_build_object('ok', true, 'outcome', 'enrolled', 'enrollmentId', v_enrollment_id);
  end if;

  -- ---------- client engine ----------
  v_shadow := not private.crm_control_plane_flag(v_job.tenant_id, 'client_trigger_cutover_enabled');

  if v_job.subject_type <> 'client' then
    update public.crm_campaign_trigger_jobs
    set status = 'skipped', skip_reason = 'subject_not_supported', updated_at = now()
    where id = v_job.id;
    return jsonb_build_object('ok', true, 'outcome', 'skipped', 'skipReason', 'subject_not_supported');
  end if;

  select * into v_client from public.clients where id = v_job.subject_id and tenant_id = v_job.tenant_id;
  if v_client.id is null then
    update public.crm_campaign_trigger_jobs
    set status = 'skipped', skip_reason = 'subject_missing', updated_at = now()
    where id = v_job.id;
    return jsonb_build_object('ok', true, 'outcome', 'skipped', 'skipReason', 'subject_missing');
  end if;

  v_expected := (select e.payload->>'to_value' from public.crm_automation_events e where e.id = v_job.event_id);
  if v_expected is not null then
    select a.to_value into v_current
    from public.crm_client_state_audit a
    where a.client_id = v_job.subject_id
      and a.dimension::text = (select e.payload->>'dimension' from public.crm_automation_events e where e.id = v_job.event_id)
    order by a.created_at desc
    limit 1;

    if v_current is distinct from v_expected then
      update public.crm_campaign_trigger_jobs
      set status = 'skipped', skip_reason = 'state_no_longer_matches',
          evaluation_result = v_job.evaluation_result || jsonb_build_object('expected', v_expected, 'current', v_current),
          updated_at = now()
      where id = v_job.id;
      return jsonb_build_object('ok', true, 'outcome', 'skipped', 'skipReason', 'state_no_longer_matches');
    end if;
  end if;

  if v_client.contact_policy::text = 'do_not_contact' then
    update public.crm_campaign_trigger_jobs
    set status = 'skipped', skip_reason = 'do_not_contact', updated_at = now()
    where id = v_job.id;
    return jsonb_build_object('ok', true, 'outcome', 'skipped', 'skipReason', 'do_not_contact');
  end if;

  if exists (
    select 1 from public.crm_campaign_enrollments e
    where e.tenant_id = v_job.tenant_id
      and e.client_id = v_job.subject_id
      and e.campaign_id = v_registry.source_campaign_id
  ) then
    update public.crm_campaign_trigger_jobs
    set status = 'skipped', skip_reason = 'already_participated', updated_at = now()
    where id = v_job.id;
    return jsonb_build_object('ok', true, 'outcome', 'skipped', 'skipReason', 'already_participated');
  end if;

  v_concurrency := public.crm_evaluate_campaign_concurrency(
    v_job.tenant_id, v_registry.id, 'client', v_job.subject_id
  );

  if not coalesce((v_concurrency->>'allowed')::boolean, false) then
    update public.crm_campaign_trigger_jobs
    set status = 'skipped', skip_reason = coalesce(v_concurrency->>'reason', 'concurrency_blocked'),
        evaluation_result = v_job.evaluation_result || jsonb_build_object('concurrency', v_concurrency),
        updated_at = now()
    where id = v_job.id;
    return jsonb_build_object('ok', true, 'outcome', 'skipped', 'skipReason', coalesce(v_concurrency->>'reason', 'concurrency_blocked'));
  end if;

  if v_shadow then
    update public.crm_campaign_trigger_jobs
    set status = 'skipped',
        skip_reason = 'shadow_mode',
        evaluation_result = v_job.evaluation_result || jsonb_build_object(
          'shadow', true,
          'wouldEnroll', true,
          'campaignRegistryId', v_registry.id,
          'sourceCampaignId', v_registry.source_campaign_id,
          'evaluatedAt', now()
        ),
        updated_at = now()
    where id = v_job.id;
    return jsonb_build_object('ok', true, 'outcome', 'shadow_would_enroll', 'campaignRegistryId', v_registry.id);
  end if;

  insert into public.crm_campaign_enrollments
    (campaign_id, client_id, tenant_id, current_step, status, enrolled_at)
  values
    (v_registry.source_campaign_id, v_job.subject_id, v_job.tenant_id, 0, 'active', now())
  returning id into v_enrollment_id;

  select id, delay_days, delay_hours, channel into v_first_step
  from public.crm_campaign_steps
  where campaign_id = v_registry.source_campaign_id and is_active = true
  order by step_order
  limit 1;

  if v_first_step.id is not null then
    v_scheduled := now()
      + make_interval(days => coalesce(v_first_step.delay_days, 0), hours => coalesce(v_first_step.delay_hours, 0));

    insert into public.crm_campaign_step_logs
      (enrollment_id, step_id, tenant_id, client_id, scheduled_for, status, channel)
    values
      (v_enrollment_id, v_first_step.id, v_job.tenant_id, v_job.subject_id, v_scheduled, 'scheduled', v_first_step.channel);
  end if;

  insert into public.crm_activity_events (tenant_id, client_id, event_type, metadata)
  values (v_job.tenant_id, v_job.subject_id, 'campaign_auto_enrolled', jsonb_build_object(
    'triggered_by', 'campaign_trigger_engine',
    'trigger_rule_id', v_rule.id,
    'campaign_id', v_registry.source_campaign_id,
    'campaign_registry_id', v_registry.id,
    'enrollment_id', v_enrollment_id
  ));

  update public.crm_campaign_trigger_jobs
  set status = 'enrolled',
      engine_enrollment_id = v_enrollment_id,
      evaluation_result = v_job.evaluation_result || jsonb_build_object('enrolledAt', now(), 'concurrency', v_concurrency),
      updated_at = now()
  where id = v_job.id;

  v_result := jsonb_build_object('ok', true, 'outcome', 'enrolled', 'enrollmentId', v_enrollment_id);
  return v_result;
exception when others then
  update public.crm_campaign_trigger_jobs
  set status = case when attempt_count >= max_attempts then 'failed' else 'pending' end,
      claim_token = null,
      claimed_at = null,
      evaluation_result = evaluation_result || jsonb_build_object('lastError', sqlerrm),
      updated_at = now()
  where id = p_job_id;
  return jsonb_build_object('ok', false, 'error_code', 'execution_failed', 'message', sqlerrm);
end;
$$;

revoke all on function public.crm_enqueue_donor_transactions(text, boolean, integer) from public;
revoke all on function public.crm_process_donor_queue(text, integer) from public;
revoke all on function public.crm_donor_overview() from public;
revoke all on function public.crm_set_bty_outreach_state(uuid, uuid, text, text) from public;
revoke all on function public.crm_list_bty_outreach_states(integer) from public;

grant execute on function public.crm_enqueue_donor_transactions(text, boolean, integer) to authenticated;
grant execute on function public.crm_process_donor_queue(text, integer) to authenticated;
grant execute on function public.crm_donor_overview() to authenticated;
grant execute on function public.crm_set_bty_outreach_state(uuid, uuid, text, text) to authenticated;
grant execute on function public.crm_list_bty_outreach_states(integer) to authenticated;
grant execute on function public.crm_process_donor_queue(text, integer) to service_role;