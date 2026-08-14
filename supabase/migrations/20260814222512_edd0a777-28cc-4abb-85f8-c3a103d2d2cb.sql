create or replace function public.newsletter_mailbox_key(p_email text)
returns text
language sql
immutable
set search_path to ''
as $$
  select case
    when p_email is null or position('@' in p_email) = 0 then null
    else lower(split_part(split_part(btrim(p_email), '@', 1), '+', 1)) || '@' || lower(split_part(btrim(p_email), '@', 2))
  end;
$$;

comment on function public.newsletter_mailbox_key(text) is
  'Mailbox-level key for newsletter unsubscribe decisions only. Never use for identity, login, campaigns or reply routing.';

create table if not exists public.crm_audience_campaigns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  audience_domain text not null check (audience_domain in ('staff', 'donor')),
  name text not null,
  description text,
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'archived')),
  concurrency_group text,
  created_by_profile_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, audience_domain, name)
);

create table if not exists public.crm_audience_campaign_steps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  campaign_id uuid not null references public.crm_audience_campaigns(id) on delete cascade,
  step_order integer not null check (step_order > 0),
  channel text not null default 'email' check (channel in ('email', 'sms')),
  delay_hours integer not null default 0 check (delay_hours >= 0),
  subject text,
  body_html text,
  body_text text,
  template_version_id uuid references public.crm_email_template_versions(id) on delete set null,
  stop_on_reply boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, step_order)
);

create table if not exists public.crm_audience_enrollments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  campaign_id uuid not null references public.crm_audience_campaigns(id) on delete cascade,
  person_id uuid references public.crm_people(id) on delete set null,
  subject_domain text not null check (subject_domain in ('staff', 'donor', 'relationship_contact', 'provider_applicant')),
  subject_record_id uuid,
  recipient_email text,
  recipient_phone text,
  status text not null default 'active'
    check (status in ('active', 'paused', 'completed', 'cancelled', 'responded', 'suppressed', 'failed')),
  current_step integer not null default 0,
  next_send_at timestamptz,
  enrolled_at timestamptz not null default now(),
  completed_at timestamptz,
  last_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_audience_step_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  enrollment_id uuid not null references public.crm_audience_enrollments(id) on delete cascade,
  step_id uuid not null references public.crm_audience_campaign_steps(id) on delete cascade,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'processing', 'sent', 'failed', 'skipped', 'suppressed', 'cancelled')),
  scheduled_at timestamptz not null default now(),
  claim_token uuid,
  claimed_at timestamptz,
  attempt_count integer not null default 0,
  sent_at timestamptz,
  provider_message_id text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (enrollment_id, step_id)
);

create index if not exists crm_audience_campaigns_tenant_idx on public.crm_audience_campaigns (tenant_id, audience_domain, status);
create index if not exists crm_audience_enrollments_due_idx on public.crm_audience_enrollments (status, next_send_at) where status = 'active';
create index if not exists crm_audience_enrollments_campaign_idx on public.crm_audience_enrollments (tenant_id, campaign_id, status);
create index if not exists crm_audience_enrollments_person_idx on public.crm_audience_enrollments (tenant_id, person_id);
create unique index if not exists crm_audience_enrollments_person_unique_idx
  on public.crm_audience_enrollments (campaign_id, person_id)
  where status in ('active', 'paused');
create index if not exists crm_audience_step_logs_enrollment_idx on public.crm_audience_step_logs (enrollment_id, status);

grant select on public.crm_audience_campaigns to authenticated;
grant select on public.crm_audience_campaign_steps to authenticated;
grant select on public.crm_audience_enrollments to authenticated;
grant select on public.crm_audience_step_logs to authenticated;
grant all on public.crm_audience_campaigns to service_role;
grant all on public.crm_audience_campaign_steps to service_role;
grant all on public.crm_audience_enrollments to service_role;
grant all on public.crm_audience_step_logs to service_role;

alter table public.crm_audience_campaigns enable row level security;
alter table public.crm_audience_campaign_steps enable row level security;
alter table public.crm_audience_enrollments enable row level security;
alter table public.crm_audience_step_logs enable row level security;

create table if not exists public.crm_newsletters (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  name text not null,
  subject text,
  body_html text,
  body_text text,
  preheader text,
  template_version_id uuid references public.crm_email_template_versions(id) on delete set null,
  audience_domains text[] not null default array['client']::text[],
  status text not null default 'draft'
    check (status in ('draft', 'scheduled', 'sending', 'sent', 'cancelled')),
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_by_profile_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create table if not exists public.crm_newsletter_recipients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  newsletter_id uuid not null references public.crm_newsletters(id) on delete cascade,
  person_id uuid references public.crm_people(id) on delete set null,
  source_domain text not null,
  source_record_id uuid,
  recipient_email text not null,
  mailbox_key text not null,
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'failed', 'suppressed', 'skipped')),
  suppression_reason text,
  provider_message_id text,
  sent_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (newsletter_id, mailbox_key)
);

create table if not exists public.crm_newsletter_suppressions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  mailbox_key text not null,
  example_email text,
  reason text not null,
  source text not null default 'operator' check (source in ('operator', 'unsubscribe_link', 'bounce', 'complaint', 'import')),
  created_by_profile_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, mailbox_key)
);

create index if not exists crm_newsletters_tenant_idx on public.crm_newsletters (tenant_id, status, scheduled_at);
create index if not exists crm_newsletter_recipients_newsletter_idx on public.crm_newsletter_recipients (newsletter_id, status);
create index if not exists crm_newsletter_recipients_mailbox_idx on public.crm_newsletter_recipients (tenant_id, mailbox_key);
create index if not exists crm_newsletter_suppressions_mailbox_idx on public.crm_newsletter_suppressions (tenant_id, mailbox_key);

grant select on public.crm_newsletters to authenticated;
grant select on public.crm_newsletter_recipients to authenticated;
grant select on public.crm_newsletter_suppressions to authenticated;
grant all on public.crm_newsletters to service_role;
grant all on public.crm_newsletter_recipients to service_role;
grant all on public.crm_newsletter_suppressions to service_role;

alter table public.crm_newsletters enable row level security;
alter table public.crm_newsletter_recipients enable row level security;
alter table public.crm_newsletter_suppressions enable row level security;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'crm_audience_campaigns', 'crm_audience_campaign_steps', 'crm_audience_enrollments', 'crm_audience_step_logs',
    'crm_newsletters', 'crm_newsletter_recipients', 'crm_newsletter_suppressions'
  ] loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = v_table and policyname = v_table || '_staff_read'
    ) then
      execute format($f$
        create policy %I on public.%I
        for select to authenticated
        using (
          exists (
            select 1 from public.tenant_memberships m
            where m.profile_id = auth.uid()
              and m.tenant_id = public.%I.tenant_id
          )
        )
      $f$, v_table || '_staff_read', v_table, v_table);
    end if;
  end loop;
end
$$;

alter table public.crm_campaign_registry
  drop constraint if exists crm_campaign_registry_engine_check;

alter table public.crm_campaign_registry
  add constraint crm_campaign_registry_engine_check
  check (engine in ('crm_campaigns', 'relationship_campaigns', 'crm_audience_campaigns'));

create or replace function private.crm_sync_audience_campaign_registry()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.crm_campaign_registry
    where engine = 'crm_audience_campaigns' and source_campaign_id = old.id;
    return old;
  end if;

  insert into public.crm_campaign_registry (
    tenant_id, campaign_domain, engine, source_campaign_id, name, status, is_active, concurrency_group
  )
  values (
    new.tenant_id, new.audience_domain, 'crm_audience_campaigns', new.id, new.name, new.status,
    new.status = 'active', new.concurrency_group
  )
  on conflict (engine, source_campaign_id) do update
  set tenant_id = excluded.tenant_id,
      campaign_domain = excluded.campaign_domain,
      name = excluded.name,
      status = excluded.status,
      is_active = excluded.is_active,
      concurrency_group = excluded.concurrency_group,
      updated_at = now();
  return new;
end;
$$;

drop trigger if exists crm_audience_campaign_registry_sync on public.crm_audience_campaigns;
create trigger crm_audience_campaign_registry_sync
after insert or update or delete on public.crm_audience_campaigns
for each row execute function private.crm_sync_audience_campaign_registry();

create or replace function private.crm_touch_updated_at()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'crm_audience_campaigns', 'crm_audience_campaign_steps', 'crm_audience_enrollments', 'crm_audience_step_logs',
    'crm_newsletters', 'crm_newsletter_recipients', 'crm_newsletter_suppressions'
  ] loop
    execute format('drop trigger if exists %I on public.%I', v_table || '_touch', v_table);
    execute format(
      'create trigger %I before update on public.%I for each row execute function private.crm_touch_updated_at()',
      v_table || '_touch', v_table
    );
  end loop;
end
$$;

create or replace function public.crm_upsert_audience_campaign(
  p_campaign_id uuid,
  p_audience_domain text,
  p_name text,
  p_description text,
  p_status text,
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
  v_profile uuid := (v_context->>'profile_id')::uuid;
  v_flag text;
  v_id uuid;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A reason is required to change an audience campaign';
  end if;
  if p_audience_domain not in ('staff', 'donor') then
    raise exception 'Unsupported audience domain: %', p_audience_domain;
  end if;

  v_flag := case p_audience_domain when 'staff' then 'staff_campaigns_enabled' else 'donor_campaigns_enabled' end;
  if p_status = 'active' and not private.crm_control_plane_flag(v_tenant, v_flag) then
    raise exception 'The % switch must be on before this campaign can be activated', v_flag;
  end if;

  if p_campaign_id is null then
    insert into public.crm_audience_campaigns (tenant_id, audience_domain, name, description, status, created_by_profile_id)
    values (v_tenant, p_audience_domain, btrim(p_name), p_description, coalesce(p_status, 'draft'), v_profile)
    returning id into v_id;
  else
    update public.crm_audience_campaigns
    set name = btrim(p_name),
        description = p_description,
        status = coalesce(p_status, status),
        updated_at = now()
    where id = p_campaign_id and tenant_id = v_tenant
    returning id into v_id;
    if v_id is null then
      raise exception 'Audience campaign not found for this tenant';
    end if;
  end if;

  insert into public.crm_activity_events (tenant_id, event_type, created_by_profile_id, metadata)
  values (
    v_tenant, 'campaign_updated', v_profile,
    jsonb_build_object('scope', 'audience_campaign', 'campaignId', v_id, 'audienceDomain', p_audience_domain,
      'status', coalesce(p_status, 'draft'), 'reason', btrim(p_reason))
  );

  return jsonb_build_object('campaignId', v_id, 'audienceDomain', p_audience_domain, 'status', coalesce(p_status, 'draft'));
end;
$$;

create or replace function public.crm_enroll_people_in_audience_campaign(
  p_campaign_id uuid,
  p_person_ids uuid[],
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
  v_profile uuid := (v_context->>'profile_id')::uuid;
  v_campaign public.crm_audience_campaigns;
  v_flag text;
  v_enrolled integer := 0;
  v_skipped_existing integer := 0;
  v_skipped_no_email integer := 0;
  v_person uuid;
  v_email text;
  v_first_step public.crm_audience_campaign_steps;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A reason is required to enrol people in a campaign';
  end if;

  select * into v_campaign
  from public.crm_audience_campaigns
  where id = p_campaign_id and tenant_id = v_tenant;
  if v_campaign.id is null then
    raise exception 'Audience campaign not found for this tenant';
  end if;
  if v_campaign.status <> 'active' then
    raise exception 'Only an active campaign can accept enrolments';
  end if;

  v_flag := case v_campaign.audience_domain when 'staff' then 'staff_campaigns_enabled' else 'donor_campaigns_enabled' end;
  if not private.crm_control_plane_flag(v_tenant, v_flag) then
    raise exception 'The % switch must be on before enrolling anyone', v_flag;
  end if;

  select * into v_first_step
  from public.crm_audience_campaign_steps
  where campaign_id = v_campaign.id and active
  order by step_order
  limit 1;
  if v_first_step.id is null then
    raise exception 'This campaign has no active steps yet';
  end if;

  foreach v_person in array coalesce(p_person_ids, array[]::uuid[]) loop
    select p.primary_email into v_email
    from public.crm_people p
    where p.id = v_person and p.tenant_id = v_tenant;

    if v_email is null or btrim(v_email) = '' then
      v_skipped_no_email := v_skipped_no_email + 1;
      continue;
    end if;

    if exists (
      select 1 from public.crm_audience_enrollments e
      where e.campaign_id = v_campaign.id
        and e.person_id = v_person
        and e.status in ('active', 'paused')
    ) then
      v_skipped_existing := v_skipped_existing + 1;
      continue;
    end if;

    insert into public.crm_audience_enrollments (
      tenant_id, campaign_id, person_id, subject_domain, subject_record_id, recipient_email,
      status, current_step, next_send_at, last_reason
    )
    values (
      v_tenant, v_campaign.id, v_person, v_campaign.audience_domain, null, lower(btrim(v_email)),
      'active', 0, now() + make_interval(hours => v_first_step.delay_hours), btrim(p_reason)
    );
    v_enrolled := v_enrolled + 1;
  end loop;

  insert into public.crm_activity_events (tenant_id, event_type, created_by_profile_id, metadata)
  values (
    v_tenant, 'campaign_enrolled', v_profile,
    jsonb_build_object('scope', 'audience_campaign', 'campaignId', v_campaign.id,
      'enrolled', v_enrolled, 'skippedExisting', v_skipped_existing, 'skippedNoEmail', v_skipped_no_email,
      'reason', btrim(p_reason))
  );

  return jsonb_build_object(
    'campaignId', v_campaign.id,
    'enrolled', v_enrolled,
    'skippedAlreadyEnrolled', v_skipped_existing,
    'skippedWithoutEmail', v_skipped_no_email
  );
end;
$$;

create or replace function public.crm_suppress_newsletter_mailbox(
  p_email text,
  p_reason text,
  p_source text default 'operator'
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_context jsonb := private.relationship_campaign_context(true);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
  v_profile uuid := (v_context->>'profile_id')::uuid;
  v_key text := public.newsletter_mailbox_key(p_email);
begin
  if v_key is null then
    raise exception 'A valid email address is required';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A reason is required to add a mailbox to the unsubscribe list';
  end if;

  insert into public.crm_newsletter_suppressions (tenant_id, mailbox_key, example_email, reason, source, created_by_profile_id)
  values (v_tenant, v_key, lower(btrim(p_email)), btrim(p_reason), coalesce(p_source, 'operator'), v_profile)
  on conflict (tenant_id, mailbox_key) do update
  set reason = excluded.reason, source = excluded.source, updated_at = now();

  update public.crm_newsletter_recipients
  set status = 'suppressed', suppression_reason = btrim(p_reason), updated_at = now()
  where tenant_id = v_tenant and mailbox_key = v_key and status = 'queued';

  insert into public.crm_activity_events (tenant_id, event_type, created_by_profile_id, metadata)
  values (
    v_tenant, 'newsletter_suppressed', v_profile,
    jsonb_build_object('mailboxKey', v_key, 'source', coalesce(p_source, 'operator'), 'reason', btrim(p_reason))
  );

  return jsonb_build_object('mailboxKey', v_key, 'suppressed', true);
end;
$$;

create or replace function public.crm_build_newsletter_recipients(
  p_newsletter_id uuid,
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
  v_profile uuid := (v_context->>'profile_id')::uuid;
  v_newsletter public.crm_newsletters;
  v_suppression_on boolean;
  v_added integer := 0;
  v_suppressed integer := 0;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A reason is required to build a newsletter recipient list';
  end if;

  select * into v_newsletter
  from public.crm_newsletters
  where id = p_newsletter_id and tenant_id = v_tenant;
  if v_newsletter.id is null then
    raise exception 'Newsletter not found for this tenant';
  end if;
  if v_newsletter.status not in ('draft', 'scheduled') then
    raise exception 'Only a draft or scheduled newsletter can have its recipient list rebuilt';
  end if;
  if not private.crm_control_plane_flag(v_tenant, 'universal_newsletters_enabled') then
    raise exception 'The universal_newsletters_enabled switch must be on before building a recipient list';
  end if;

  v_suppression_on := private.crm_control_plane_flag(v_tenant, 'newsletter_mailbox_suppression_enabled');

  delete from public.crm_newsletter_recipients
  where newsletter_id = v_newsletter.id and status = 'queued';

  with candidates as (
    select distinct on (public.newsletter_mailbox_key(p.primary_email))
      p.id as person_id,
      r.record_domain,
      r.record_id,
      lower(btrim(p.primary_email)) as recipient_email,
      public.newsletter_mailbox_key(p.primary_email) as mailbox_key
    from public.crm_people p
    join public.crm_person_records r on r.person_id = p.id and r.tenant_id = p.tenant_id
    where p.tenant_id = v_tenant
      and p.primary_email is not null
      and btrim(p.primary_email) <> ''
      and r.record_domain = any (v_newsletter.audience_domains)
    order by public.newsletter_mailbox_key(p.primary_email), p.created_at
  ), inserted as (
    insert into public.crm_newsletter_recipients (
      tenant_id, newsletter_id, person_id, source_domain, source_record_id,
      recipient_email, mailbox_key, status, suppression_reason
    )
    select
      v_tenant, v_newsletter.id, c.person_id, c.record_domain, c.record_id,
      c.recipient_email, c.mailbox_key,
      case when v_suppression_on and s.mailbox_key is not null then 'suppressed' else 'queued' end,
      case when v_suppression_on and s.mailbox_key is not null then s.reason else null end
    from candidates c
    left join public.crm_newsletter_suppressions s
      on s.tenant_id = v_tenant and s.mailbox_key = c.mailbox_key
    on conflict (newsletter_id, mailbox_key) do nothing
    returning status
  )
  select
    count(*) filter (where status = 'queued'),
    count(*) filter (where status = 'suppressed')
  into v_added, v_suppressed
  from inserted;

  insert into public.crm_activity_events (tenant_id, event_type, created_by_profile_id, metadata)
  values (
    v_tenant, 'newsletter_recipients_built', v_profile,
    jsonb_build_object('newsletterId', v_newsletter.id, 'queued', coalesce(v_added, 0), 'suppressed', coalesce(v_suppressed, 0),
      'suppressionEnforced', v_suppression_on, 'reason', btrim(p_reason))
  );

  return jsonb_build_object(
    'newsletterId', v_newsletter.id,
    'queued', coalesce(v_added, 0),
    'suppressed', coalesce(v_suppressed, 0),
    'suppressionEnforced', v_suppression_on
  );
end;
$$;

create or replace function public.crm_list_audience_campaigns()
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
      'id', c.id,
      'audienceDomain', c.audience_domain,
      'name', c.name,
      'description', c.description,
      'status', c.status,
      'stepCount', (select count(*) from public.crm_audience_campaign_steps s where s.campaign_id = c.id and s.active),
      'activeEnrollments', (select count(*) from public.crm_audience_enrollments e where e.campaign_id = c.id and e.status = 'active'),
      'updatedAt', c.updated_at
    ) order by c.audience_domain, c.name)
    from public.crm_audience_campaigns c
    where c.tenant_id = v_tenant
  ), '[]'::jsonb);
end;
$$;

create or replace function public.crm_list_newsletters()
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
    'newsletters', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', n.id,
        'name', n.name,
        'subject', n.subject,
        'status', n.status,
        'audienceDomains', n.audience_domains,
        'scheduledAt', n.scheduled_at,
        'queued', (select count(*) from public.crm_newsletter_recipients r where r.newsletter_id = n.id and r.status = 'queued'),
        'sent', (select count(*) from public.crm_newsletter_recipients r where r.newsletter_id = n.id and r.status = 'sent'),
        'suppressed', (select count(*) from public.crm_newsletter_recipients r where r.newsletter_id = n.id and r.status = 'suppressed'),
        'updatedAt', n.updated_at
      ) order by n.updated_at desc)
      from public.crm_newsletters n
      where n.tenant_id = v_tenant
    ), '[]'::jsonb),
    'suppressedMailboxes', (
      select count(*) from public.crm_newsletter_suppressions s where s.tenant_id = v_tenant
    )
  );
end;
$$;

revoke all on function public.crm_upsert_audience_campaign(uuid, text, text, text, text, text) from public;
revoke all on function public.crm_enroll_people_in_audience_campaign(uuid, uuid[], text) from public;
revoke all on function public.crm_suppress_newsletter_mailbox(text, text, text) from public;
revoke all on function public.crm_build_newsletter_recipients(uuid, text) from public;
revoke all on function public.crm_list_audience_campaigns() from public;
revoke all on function public.crm_list_newsletters() from public;

grant execute on function public.crm_upsert_audience_campaign(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.crm_enroll_people_in_audience_campaign(uuid, uuid[], text) to authenticated;
grant execute on function public.crm_suppress_newsletter_mailbox(text, text, text) to authenticated;
grant execute on function public.crm_build_newsletter_recipients(uuid, text) to authenticated;
grant execute on function public.crm_list_audience_campaigns() to authenticated;
grant execute on function public.crm_list_newsletters() to authenticated;
grant execute on function public.newsletter_mailbox_key(text) to authenticated, service_role;