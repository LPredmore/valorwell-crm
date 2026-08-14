-- =============================================================
-- PHASE 15 — universal newsletter recipient model
-- =============================================================
alter table public.crm_newsletter_recipients
  add column if not exists qualifying_audiences text[] not null default '{}'::text[],
  add column if not exists source_memberships jsonb not null default '[]'::jsonb,
  add column if not exists suppression_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists greeting_name text,
  add column if not exists email_message_id uuid references public.crm_email_messages(id) on delete set null,
  add column if not exists claim_token uuid,
  add column if not exists claimed_at timestamptz,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists error_code text;

alter table public.crm_newsletter_recipients
  drop constraint if exists crm_newsletter_recipients_status_check;

alter table public.crm_newsletter_recipients
  add constraint crm_newsletter_recipients_status_check
  check (status = any (array['pending','processing','queued','sent','failed','suppressed','skipped']));

create index if not exists crm_newsletter_recipients_newsletter_status_idx
  on public.crm_newsletter_recipients (newsletter_id, status);
create index if not exists crm_newsletter_recipients_claim_idx
  on public.crm_newsletter_recipients (status, claimed_at);
create index if not exists crm_newsletter_recipients_mailbox_idx
  on public.crm_newsletter_recipients (tenant_id, mailbox_key);

alter table public.crm_newsletters
  add column if not exists audience_filters jsonb not null default '{}'::jsonb;

-- =============================================================
-- PHASE 18 — newsletter-only suppression reason codes
-- =============================================================
alter table public.crm_newsletter_suppressions
  add column if not exists reason_code text not null default 'manual';

alter table public.crm_newsletter_suppressions
  drop constraint if exists crm_newsletter_suppressions_reason_code_check;

alter table public.crm_newsletter_suppressions
  add constraint crm_newsletter_suppressions_reason_code_check
  check (reason_code = any (array['unsubscribe','complaint','hard_bounce','manual']));

create or replace function private.crm_newsletter_reason_code(p_source text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_source
    when 'unsubscribe_link' then 'unsubscribe'
    when 'complaint' then 'complaint'
    when 'bounce' then 'hard_bounce'
    else 'manual'
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
set search_path = public
as $$
declare
  v_context jsonb := private.relationship_campaign_context(true);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
  v_profile uuid := (v_context->>'profile_id')::uuid;
  v_mailbox text := public.newsletter_mailbox_key(p_email);
  v_reason_code text := private.crm_newsletter_reason_code(coalesce(nullif(btrim(p_source), ''), 'operator'));
begin
  if v_mailbox is null then
    raise exception 'A valid email address is required to unsubscribe a mailbox';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A reason is required to unsubscribe a mailbox';
  end if;

  insert into public.crm_newsletter_suppressions (
    tenant_id, mailbox_key, example_email, reason, reason_code, source, created_by_profile_id
  ) values (
    v_tenant, v_mailbox, lower(btrim(p_email)), btrim(p_reason), v_reason_code,
    coalesce(nullif(btrim(p_source), ''), 'operator'), v_profile
  )
  on conflict (tenant_id, mailbox_key) do update
  set reason = excluded.reason,
      reason_code = excluded.reason_code,
      source = excluded.source,
      example_email = coalesce(public.crm_newsletter_suppressions.example_email, excluded.example_email),
      updated_at = now();

  insert into public.crm_activity_events (tenant_id, event_type, created_by_profile_id, metadata)
  values (
    v_tenant, 'newsletter_mailbox_suppressed', v_profile,
    jsonb_build_object('mailboxKey', v_mailbox, 'reason', btrim(p_reason), 'reasonCode', v_reason_code, 'source', coalesce(nullif(btrim(p_source), ''), 'operator'))
  );

  return jsonb_build_object('mailboxKey', v_mailbox, 'reasonCode', v_reason_code);
end;
$$;

-- =============================================================
-- PHASE 16 — universal newsletter audience resolver
-- =============================================================
create or replace function private.crm_newsletter_greeting_first_name(p_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(split_part(btrim(coalesce(p_name, '')), ' ', 1), '');
$$;

create or replace function private.crm_newsletter_candidates(
  p_tenant_id uuid,
  p_domains text[]
)
returns table (
  audience_domain text,
  record_id uuid,
  person_id uuid,
  candidate_email text,
  candidate_name text
)
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    -- clients: excluded when their own contact policy forbids contact
    select
      'client'::text as audience_domain,
      c.id as record_id,
      lower(btrim(c.email)) as candidate_email,
      coalesce(nullif(btrim(c.pat_name_preferred), ''), nullif(btrim(c.pat_name_f), '')) as candidate_name
    from public.clients c
    where c.tenant_id = p_tenant_id
      and 'client' = any (p_domains)
      and c.email is not null and btrim(c.email) <> ''
      and coalesce(c.contact_policy::text, '') <> 'do_not_contact'
      and coalesce(c.pat_status::text, '') <> 'deleted'

    union all

    -- staff: excluded when the underlying login is deactivated
    select
      'staff'::text,
      s.id,
      lower(btrim(pr.email)),
      coalesce(nullif(btrim(s.prov_name_for_clients), ''), nullif(btrim(s.prov_name_f), ''))
    from public.staff s
    join public.profiles pr on pr.id = s.profile_id
    where s.tenant_id = p_tenant_id
      and 'staff' = any (p_domains)
      and pr.email is not null and btrim(pr.email) <> ''
      and coalesce(pr.is_active, true) is true
      and coalesce(s.prov_status::text, '') not in ('inactive', 'terminated')

    union all

    -- beyond the yellow contacts: excluded on do-not-contact or an active suppression
    select
      'bty'::text,
      rc.id,
      lower(btrim(rc.email)),
      coalesce(nullif(btrim(rc.preferred_name), ''), nullif(btrim(rc.first_name), ''))
    from public.relationship_contacts rc
    where rc.tenant_id = p_tenant_id
      and 'bty' = any (p_domains)
      and rc.email is not null and btrim(rc.email) <> ''
      and coalesce(rc.do_not_contact, false) is false
      and not exists (
        select 1
        from public.relationship_suppressions rs
        where rs.tenant_id = rc.tenant_id
          and rs.revoked_at is null
          and (rs.expires_at is null or rs.expires_at > now())
          and (
            rs.contact_id = rc.id
            or (rs.email is not null and lower(btrim(rs.email)) = lower(btrim(rc.email)))
          )
      )

    union all

    -- donors: excluded when they have opted out of communication
    select
      'donor'::text,
      d.id,
      lower(btrim(d.primary_email)),
      nullif(btrim(d.display_name), '')
    from public.crm_donors d
    where d.tenant_id = p_tenant_id
      and 'donor' = any (p_domains)
      and d.primary_email is not null and btrim(d.primary_email) <> ''
      and coalesce(d.communication_opt_in, true) is true
  )
  select
    b.audience_domain,
    b.record_id,
    rec.person_id,
    b.candidate_email,
    b.candidate_name
  from base b
  left join public.crm_person_records rec
    on rec.tenant_id = p_tenant_id
   and rec.record_domain = b.audience_domain
   and rec.record_id = b.record_id
  where b.candidate_email is not null
    and b.candidate_email like '%@%';
$$;

create or replace function public.crm_build_newsletter_recipients(
  p_newsletter_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_context jsonb := private.relationship_campaign_context(true);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
  v_profile uuid := (v_context->>'profile_id')::uuid;
  v_newsletter public.crm_newsletters;
  v_suppression_on boolean;
  v_added integer := 0;
  v_suppressed integer := 0;
  v_memberships integer := 0;
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
  where newsletter_id = v_newsletter.id
    and status in ('pending', 'queued', 'suppressed', 'skipped');

  with candidates as (
    select
      c.audience_domain,
      c.record_id,
      c.person_id,
      c.candidate_email,
      c.candidate_name,
      public.newsletter_mailbox_key(c.candidate_email) as mailbox_key,
      position('+' in split_part(c.candidate_email, '@', 1)) > 0 as is_alias
    from private.crm_newsletter_candidates(v_tenant, v_newsletter.audience_domains) c
    where public.newsletter_mailbox_key(c.candidate_email) is not null
  ), grouped as (
    select
      mailbox_key,
      (array_agg(candidate_email order by is_alias, candidate_email))[1] as delivery_email,
      array_agg(distinct audience_domain) as qualifying_audiences,
      jsonb_agg(
        jsonb_build_object(
          'domain', audience_domain,
          'recordId', record_id,
          'personId', person_id,
          'email', candidate_email
        ) order by audience_domain, candidate_email
      ) as source_memberships,
      count(*) as membership_count,
      count(distinct person_id) filter (where person_id is not null) as person_count,
      (array_agg(person_id) filter (where person_id is not null))[1] as person_id,
      count(distinct lower(coalesce(candidate_name, ''))) as name_variants,
      (array_agg(candidate_name order by is_alias, candidate_email))[1] as primary_name
    from candidates
    group by mailbox_key
  ), resolved as (
    select
      g.*,
      s.mailbox_key is not null as is_suppressed,
      s.reason as suppression_reason,
      s.reason_code as suppression_reason_code,
      s.source as suppression_source,
      case
        when g.membership_count = 1 or (g.person_count = 1 and g.name_variants = 1)
          then private.crm_newsletter_greeting_first_name(g.primary_name)
        else null
      end as greeting_first_name
    from grouped g
    left join public.crm_newsletter_suppressions s
      on s.tenant_id = v_tenant and s.mailbox_key = g.mailbox_key
  ), inserted as (
    insert into public.crm_newsletter_recipients (
      tenant_id, newsletter_id, person_id, source_domain, source_record_id,
      recipient_email, mailbox_key, status, suppression_reason,
      qualifying_audiences, source_memberships, suppression_snapshot, greeting_name
    )
    select
      v_tenant,
      v_newsletter.id,
      case when r.person_count = 1 then r.person_id else null end,
      r.qualifying_audiences[1],
      case when r.membership_count = 1 then (r.source_memberships->0->>'recordId')::uuid else null end,
      r.delivery_email,
      r.mailbox_key,
      case when v_suppression_on and r.is_suppressed then 'suppressed' else 'pending' end,
      case when v_suppression_on and r.is_suppressed then r.suppression_reason else null end,
      r.qualifying_audiences,
      r.source_memberships,
      jsonb_build_object(
        'suppressionEnforced', v_suppression_on,
        'mailboxSuppressed', r.is_suppressed,
        'reason', r.suppression_reason,
        'reasonCode', r.suppression_reason_code,
        'source', r.suppression_source,
        'capturedAt', now()
      ),
      coalesce(r.greeting_first_name, 'Friend')
    from resolved r
    on conflict (newsletter_id, mailbox_key) do nothing
    returning status, jsonb_array_length(source_memberships) as memberships
  )
  select
    coalesce(count(*) filter (where status = 'pending'), 0),
    coalesce(count(*) filter (where status = 'suppressed'), 0),
    coalesce(sum(memberships), 0)
  into v_added, v_suppressed, v_memberships
  from inserted;

  insert into public.crm_activity_events (tenant_id, event_type, created_by_profile_id, metadata)
  values (
    v_tenant, 'newsletter_recipients_built', v_profile,
    jsonb_build_object(
      'newsletterId', v_newsletter.id,
      'queued', v_added,
      'suppressed', v_suppressed,
      'sourceMemberships', v_memberships,
      'audienceDomains', v_newsletter.audience_domains,
      'suppressionEnforced', v_suppression_on,
      'reason', btrim(p_reason)
    )
  );

  return jsonb_build_object(
    'newsletterId', v_newsletter.id,
    'queued', v_added,
    'suppressed', v_suppressed,
    'sourceMemberships', v_memberships,
    'suppressionEnforced', v_suppression_on
  );
end;
$$;

create or replace function public.crm_list_newsletters()
returns jsonb
language plpgsql
security definer
set search_path = public
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
        'queued', (select count(*) from public.crm_newsletter_recipients r where r.newsletter_id = n.id and r.status in ('pending', 'queued')),
        'processing', (select count(*) from public.crm_newsletter_recipients r where r.newsletter_id = n.id and r.status = 'processing'),
        'sent', (select count(*) from public.crm_newsletter_recipients r where r.newsletter_id = n.id and r.status = 'sent'),
        'failed', (select count(*) from public.crm_newsletter_recipients r where r.newsletter_id = n.id and r.status = 'failed'),
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

-- =============================================================
-- PHASE 19 — mailbox-level newsletter unsubscribe tokens
--            (legacy client unsubscribe behaviour left untouched)
-- =============================================================
create table if not exists private.crm_newsletter_unsubscribe_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  tenant_id uuid not null,
  newsletter_id uuid not null references public.crm_newsletters(id) on delete cascade,
  recipient_id uuid not null references public.crm_newsletter_recipients(id) on delete cascade,
  mailbox_key text not null,
  delivery_email text not null,
  expires_at timestamptz not null default now() + interval '2 years',
  used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (recipient_id)
);

create or replace function public.crm_issue_newsletter_unsubscribe_token(p_recipient_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient public.crm_newsletter_recipients;
  v_token text := encode(gen_random_bytes(24), 'hex');
  v_existing text;
begin
  select * into v_recipient
  from public.crm_newsletter_recipients
  where id = p_recipient_id;

  if v_recipient.id is null then
    raise exception 'Newsletter recipient not found' using errcode = '42501';
  end if;

  select token_hash into v_existing
  from private.crm_newsletter_unsubscribe_tokens
  where recipient_id = v_recipient.id;

  if v_existing is not null then
    -- an issued token is never invalidated; extend its life instead
    update private.crm_newsletter_unsubscribe_tokens
    set expires_at = greatest(expires_at, now() + interval '2 years'), updated_at = now()
    where recipient_id = v_recipient.id;
    return null;
  end if;

  insert into private.crm_newsletter_unsubscribe_tokens (
    token_hash, tenant_id, newsletter_id, recipient_id, mailbox_key, delivery_email
  ) values (
    encode(digest(v_token, 'sha256'), 'hex'), v_recipient.tenant_id, v_recipient.newsletter_id,
    v_recipient.id, v_recipient.mailbox_key, v_recipient.recipient_email
  );

  return v_token;
end;
$$;

create or replace function public.crm_process_newsletter_unsubscribe(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token private.crm_newsletter_unsubscribe_tokens%rowtype;
  v_already boolean;
begin
  if nullif(btrim(p_token), '') is null then
    return jsonb_build_object('outcome', 'invalid_token');
  end if;

  select * into v_token
  from private.crm_newsletter_unsubscribe_tokens
  where token_hash = encode(digest(btrim(p_token), 'sha256'), 'hex');

  if not found then
    return jsonb_build_object('outcome', 'invalid_token');
  end if;
  if v_token.expires_at < now() then
    return jsonb_build_object('outcome', 'expired_token');
  end if;

  select exists (
    select 1 from public.crm_newsletter_suppressions
    where tenant_id = v_token.tenant_id and mailbox_key = v_token.mailbox_key
  ) into v_already;

  insert into public.crm_newsletter_suppressions (
    tenant_id, mailbox_key, example_email, reason, reason_code, source
  ) values (
    v_token.tenant_id, v_token.mailbox_key, v_token.delivery_email,
    'Newsletter unsubscribe link', 'unsubscribe', 'unsubscribe_link'
  )
  on conflict (tenant_id, mailbox_key) do update
  set reason = 'Newsletter unsubscribe link',
      reason_code = 'unsubscribe',
      source = 'unsubscribe_link',
      updated_at = now();

  update public.crm_newsletter_recipients
  set status = case when status in ('pending', 'queued') then 'suppressed' else status end,
      suppression_reason = case when status in ('pending', 'queued') then 'Newsletter unsubscribe link' else suppression_reason end,
      updated_at = now()
  where tenant_id = v_token.tenant_id
    and mailbox_key = v_token.mailbox_key
    and status in ('pending', 'queued');

  update private.crm_newsletter_unsubscribe_tokens
  set used_at = coalesce(used_at, now()), updated_at = now()
  where id = v_token.id;

  insert into public.crm_activity_events (tenant_id, event_type, metadata)
  values (
    v_token.tenant_id, 'newsletter_mailbox_suppressed',
    jsonb_build_object(
      'mailboxKey', v_token.mailbox_key,
      'newsletterId', v_token.newsletter_id,
      'reasonCode', 'unsubscribe',
      'source', 'unsubscribe_link'
    )
  );

  return jsonb_build_object('outcome', case when v_already then 'already_unsubscribed' else 'unsubscribed' end);
end;
$$;

revoke all on function public.crm_issue_newsletter_unsubscribe_token(uuid) from public;
grant execute on function public.crm_issue_newsletter_unsubscribe_token(uuid) to service_role;
grant execute on function public.crm_process_newsletter_unsubscribe(text) to anon, authenticated, service_role;
grant execute on function public.crm_build_newsletter_recipients(uuid, text) to authenticated;
grant execute on function public.crm_list_newsletters() to authenticated;
grant execute on function public.crm_suppress_newsletter_mailbox(text, text, text) to authenticated;
