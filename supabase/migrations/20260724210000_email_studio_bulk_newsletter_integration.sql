-- Email Studio Pass 9: canonical client bulk newsletters, unsubscribe handling,
-- resumable recipient claims, and capability-aligned bulk-send authorization.

alter table public.crm_resend_email_settings
  add column if not exists postal_address text;

alter table public.crm_bulk_send_logs
  drop constraint if exists crm_bulk_send_logs_content_mode_check;

alter table public.crm_bulk_send_logs
  add constraint crm_bulk_send_logs_content_mode_check
  check (content_mode is null or content_mode = 'newsletter');

alter table public.crm_bulk_send_recipients
  add column if not exists email_message_id uuid references public.crm_email_messages(id) on delete set null,
  add column if not exists claim_token uuid,
  add column if not exists claimed_at timestamptz;

alter table public.crm_bulk_send_recipients
  drop constraint if exists crm_bulk_send_recipients_status_check;

alter table public.crm_bulk_send_recipients
  add constraint crm_bulk_send_recipients_status_check
  check (status = any (array['pending','processing','sent','failed']::text[]));

create unique index if not exists crm_bulk_send_recipients_bulk_client_key
  on public.crm_bulk_send_recipients(bulk_send_id, client_id);

create index if not exists crm_bulk_send_recipients_claim_queue_idx
  on public.crm_bulk_send_recipients(bulk_send_id, status, claimed_at, id);

create index if not exists crm_bulk_send_recipients_email_message_idx
  on public.crm_bulk_send_recipients(email_message_id)
  where email_message_id is not null;

create table if not exists private.crm_client_unsubscribe_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  bulk_send_id uuid not null references public.crm_bulk_send_logs(id) on delete cascade,
  recipient_id uuid not null unique references public.crm_bulk_send_recipients(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_client_unsubscribe_tokens_expiry_check check (expires_at > created_at)
);

alter table private.crm_client_unsubscribe_tokens enable row level security;
revoke all on private.crm_client_unsubscribe_tokens from public, anon, authenticated;
grant all on private.crm_client_unsubscribe_tokens to service_role;

create index if not exists crm_client_unsubscribe_tokens_tenant_client_idx
  on private.crm_client_unsubscribe_tokens(tenant_id, client_id, created_at desc);

create or replace function public.validate_crm_bulk_send_email_studio()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.editor_document is null then
    if tg_op = 'INSERT' and new.recipient_type = 'client' then
      raise exception 'New client bulk sends require canonical Newsletter-mode Email Studio content' using errcode = '23514';
    end if;
    if new.content_mode is not null
      or new.preheader is not null
      or new.theme_key is not null
      or new.editor_schema_version is not null
      or new.render_hash is not null
      or new.template_version_id is not null then
      raise exception 'Legacy bulk sends cannot contain partial Email Studio fields' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.recipient_type <> 'client' then
    raise exception 'Canonical Newsletter-mode bulk sends are client-only' using errcode = '23514';
  end if;
  if new.content_mode is distinct from 'newsletter' then
    raise exception 'Canonical client bulk email must use newsletter mode' using errcode = '23514';
  end if;
  if nullif(btrim(new.subject), '') is null
    or nullif(btrim(new.body_html), '') is null
    or nullif(btrim(new.body_text), '') is null then
    raise exception 'Canonical newsletter subject, HTML, and text are required' using errcode = '23514';
  end if;
  if not jsonb_path_exists(
    new.editor_document,
    '$.** ? (@.type == "emailStudioBlock" && @.attrs.kind == "compliance-footer")'
  ) then
    raise exception 'Canonical newsletters require a compliance footer block' using errcode = '23514';
  end if;

  if new.template_version_id is not null and not exists (
    select 1
    from public.crm_email_template_versions version
    where version.tenant_id = new.tenant_id
      and version.id = new.template_version_id
      and version.content_scope = 'client'
      and version.content_mode = 'newsletter'
  ) then
    raise exception 'Newsletter template version is invalid for this tenant and scope' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_crm_bulk_send_email_studio() from public;

drop trigger if exists validate_crm_bulk_send_email_studio_trigger on public.crm_bulk_send_logs;
create trigger validate_crm_bulk_send_email_studio_trigger
before insert or update of
  tenant_id, recipient_type, subject, body_html, body_text, editor_document,
  preheader, content_mode, theme_key, editor_schema_version, render_hash,
  template_version_id
on public.crm_bulk_send_logs
for each row execute function public.validate_crm_bulk_send_email_studio();

do $$
declare
  policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'crm_bulk_send_logs',
        'crm_bulk_send_recipients',
        'crm_bulk_send_staff_recipients'
      )
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  end loop;
end;
$$;

revoke all on public.crm_bulk_send_logs from anon, authenticated;
revoke all on public.crm_bulk_send_recipients from anon, authenticated;
revoke all on public.crm_bulk_send_staff_recipients from anon, authenticated;

grant select, insert, update, delete on public.crm_bulk_send_logs to authenticated;
grant select, insert, update, delete on public.crm_bulk_send_recipients to authenticated;
grant select, insert, update, delete on public.crm_bulk_send_staff_recipients to authenticated;
grant all on public.crm_bulk_send_logs to service_role;
grant all on public.crm_bulk_send_recipients to service_role;
grant all on public.crm_bulk_send_staff_recipients to service_role;

create policy crm_bulk_send_logs_select
on public.crm_bulk_send_logs
for select
to authenticated
using (
  exists (
    select 1 from public.crm_user_capabilities capability
    where capability.profile_id = auth.uid()
      and capability.tenant_id = crm_bulk_send_logs.tenant_id
      and capability.crm_role <> 'crm_none'
  )
);

create policy crm_bulk_send_logs_mutate
on public.crm_bulk_send_logs
for all
to authenticated
using (
  exists (
    select 1 from public.crm_user_capabilities capability
    where capability.profile_id = auth.uid()
      and capability.tenant_id = crm_bulk_send_logs.tenant_id
      and capability.crm_role in ('crm_admin','crm_operator')
  )
)
with check (
  exists (
    select 1 from public.crm_user_capabilities capability
    where capability.profile_id = auth.uid()
      and capability.tenant_id = crm_bulk_send_logs.tenant_id
      and capability.crm_role in ('crm_admin','crm_operator')
  )
);

create policy crm_bulk_send_recipients_select
on public.crm_bulk_send_recipients
for select
to authenticated
using (
  exists (
    select 1 from public.crm_user_capabilities capability
    where capability.profile_id = auth.uid()
      and capability.tenant_id = crm_bulk_send_recipients.tenant_id
      and capability.crm_role <> 'crm_none'
  )
);

create policy crm_bulk_send_recipients_mutate
on public.crm_bulk_send_recipients
for all
to authenticated
using (
  exists (
    select 1 from public.crm_user_capabilities capability
    where capability.profile_id = auth.uid()
      and capability.tenant_id = crm_bulk_send_recipients.tenant_id
      and capability.crm_role in ('crm_admin','crm_operator')
  )
)
with check (
  exists (
    select 1 from public.crm_user_capabilities capability
    where capability.profile_id = auth.uid()
      and capability.tenant_id = crm_bulk_send_recipients.tenant_id
      and capability.crm_role in ('crm_admin','crm_operator')
  )
);

create policy crm_bulk_send_staff_recipients_select
on public.crm_bulk_send_staff_recipients
for select
to authenticated
using (
  exists (
    select 1 from public.crm_user_capabilities capability
    where capability.profile_id = auth.uid()
      and capability.tenant_id = crm_bulk_send_staff_recipients.tenant_id
      and capability.crm_role <> 'crm_none'
  )
);

create policy crm_bulk_send_staff_recipients_mutate
on public.crm_bulk_send_staff_recipients
for all
to authenticated
using (
  exists (
    select 1 from public.crm_user_capabilities capability
    where capability.profile_id = auth.uid()
      and capability.tenant_id = crm_bulk_send_staff_recipients.tenant_id
      and capability.crm_role in ('crm_admin','crm_operator')
  )
)
with check (
  exists (
    select 1 from public.crm_user_capabilities capability
    where capability.profile_id = auth.uid()
      and capability.tenant_id = crm_bulk_send_staff_recipients.tenant_id
      and capability.crm_role in ('crm_admin','crm_operator')
  )
);

create or replace function public.crm_create_bulk_newsletter(
  p_tenant_id uuid,
  p_client_ids uuid[],
  p_subject text,
  p_content jsonb,
  p_template_id uuid default null,
  p_template_version_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_bulk_send_id uuid := gen_random_uuid();
  v_requested_count integer;
  v_eligible_count integer;
  v_actual_template_id uuid;
  v_version record;
begin
  if v_actor is null or not exists (
    select 1
    from public.crm_user_capabilities capability
    where capability.profile_id = v_actor
      and capability.tenant_id = p_tenant_id
      and capability.crm_role in ('crm_admin','crm_operator')
  ) then
    raise exception 'Not authorized for tenant %', p_tenant_id using errcode = '42501';
  end if;

  if p_client_ids is null or cardinality(p_client_ids) = 0 then
    raise exception 'At least one client is required' using errcode = '22023';
  end if;

  select count(distinct client_id)
    into v_requested_count
  from unnest(p_client_ids) as selected(client_id)
  where client_id is not null;

  if v_requested_count = 0 or v_requested_count > 500 then
    raise exception 'Newsletter recipient count must be between 1 and 500' using errcode = '22023';
  end if;
  if nullif(btrim(p_subject), '') is null then
    raise exception 'Newsletter subject is required' using errcode = '23514';
  end if;
  if jsonb_typeof(p_content) <> 'object'
    or p_content->>'mode' <> 'newsletter'
    or jsonb_typeof(p_content->'editorDocument') <> 'object'
    or p_content->'editorDocument'->>'type' <> 'doc'
    or jsonb_typeof(p_content->'editorDocument'->'content') <> 'array'
    or nullif(btrim(p_content->>'renderedHtml'), '') is null
    or nullif(btrim(p_content->>'renderedText'), '') is null
    or nullif(btrim(p_content->>'themeKey'), '') is null
    or coalesce((p_content->>'schemaVersion')::integer, 0) < 1
    or coalesce(p_content->>'renderHash', '') !~ '^(sha256:[0-9a-f]{64}|fnv1a32:[0-9a-f]{8})$' then
    raise exception 'Canonical Newsletter-mode content is invalid' using errcode = '23514';
  end if;
  if not jsonb_path_exists(
    p_content->'editorDocument',
    '$.** ? (@.type == "emailStudioBlock" && @.attrs.kind == "compliance-footer")'
  ) then
    raise exception 'Newsletter content requires a compliance footer block' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.crm_resend_email_settings settings
    where settings.tenant_id = p_tenant_id
      and settings.connection_status = 'connected'
      and nullif(btrim(settings.from_email), '') is not null
      and nullif(btrim(settings.postal_address), '') is not null
  ) then
    raise exception 'Verified Resend settings and a mailing address are required' using errcode = '23514';
  end if;

  select count(*)
    into v_eligible_count
  from public.clients client
  where client.tenant_id = p_tenant_id
    and client.id in (
      select distinct selected.client_id
      from unnest(p_client_ids) as selected(client_id)
      where selected.client_id is not null
    )
    and nullif(btrim(client.email), '') is not null
    and client.contact_policy = 'normal'
    and client.service_policy = 'normal'
    and client.lifecycle_stage <> 'closed';

  if v_eligible_count <> v_requested_count then
    raise exception 'One or more selected clients is not currently eligible for ordinary newsletter outreach' using errcode = '23514';
  end if;

  if p_template_version_id is not null then
    select *
      into v_version
    from public.crm_email_template_versions version
    where version.tenant_id = p_tenant_id
      and version.id = p_template_version_id
      and version.content_scope = 'client'
      and version.content_mode = 'newsletter';

    if not found then
      raise exception 'Newsletter template version is invalid for this tenant and scope' using errcode = '23514';
    end if;
    v_actual_template_id := v_version.template_id;
    if p_template_id is not null and p_template_id <> v_actual_template_id then
      raise exception 'Template and template-version identities do not match' using errcode = '23514';
    end if;
    if v_version.subject <> btrim(p_subject)
      or v_version.editor_document <> p_content->'editorDocument'
      or v_version.rendered_html <> p_content->>'renderedHtml'
      or v_version.rendered_text <> p_content->>'renderedText'
      or coalesce(v_version.preheader, '') <> coalesce(p_content->>'preheader', '')
      or v_version.theme_key <> p_content->>'themeKey'
      or v_version.editor_schema_version <> (p_content->>'schemaVersion')::integer
      or v_version.render_hash <> p_content->>'renderHash' then
      raise exception 'Newsletter content no longer matches the attributed template version' using errcode = '23514';
    end if;
  elsif p_template_id is not null then
    raise exception 'Template identity requires a template version' using errcode = '23514';
  end if;

  insert into public.crm_bulk_send_logs (
    id, tenant_id, recipient_type, subject, body_html, body_text,
    editor_document, preheader, content_mode, theme_key,
    editor_schema_version, render_hash, template_id, template_version_id,
    status, recipient_count, sent_count, failed_count, created_by_profile_id
  ) values (
    v_bulk_send_id, p_tenant_id, 'client', btrim(p_subject),
    p_content->>'renderedHtml', p_content->>'renderedText',
    p_content->'editorDocument', nullif(p_content->>'preheader', ''),
    'newsletter', p_content->>'themeKey',
    (p_content->>'schemaVersion')::integer, p_content->>'renderHash',
    coalesce(p_template_id, v_actual_template_id), p_template_version_id,
    'pending', v_requested_count, 0, 0, v_actor
  );

  insert into public.crm_bulk_send_recipients (
    tenant_id, bulk_send_id, client_id, status
  )
  select p_tenant_id, v_bulk_send_id, selected.client_id, 'pending'
  from (
    select distinct client_id
    from unnest(p_client_ids) as requested(client_id)
    where client_id is not null
  ) selected;

  return jsonb_build_object(
    'bulk_send_id', v_bulk_send_id,
    'recipient_count', v_requested_count
  );
end;
$$;

revoke all on function public.crm_create_bulk_newsletter(uuid, uuid[], text, jsonb, uuid, uuid) from public;
grant execute on function public.crm_create_bulk_newsletter(uuid, uuid[], text, jsonb, uuid, uuid) to authenticated, service_role;

create or replace function public.crm_claim_bulk_client_recipients(
  p_tenant_id uuid,
  p_bulk_send_id uuid,
  p_limit integer default 25
)
returns table (
  id uuid,
  client_id uuid,
  email_message_id uuid,
  claim_token uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_limit < 1 or p_limit > 50 then
    raise exception 'Claim limit must be between 1 and 50' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.crm_bulk_send_logs job
    where job.id = p_bulk_send_id
      and job.tenant_id = p_tenant_id
      and job.recipient_type = 'client'
  ) then
    raise exception 'Client bulk-send job not found' using errcode = '42704';
  end if;

  return query
  with candidates as (
    select recipient.id
    from public.crm_bulk_send_recipients recipient
    where recipient.tenant_id = p_tenant_id
      and recipient.bulk_send_id = p_bulk_send_id
      and (
        recipient.status = 'pending'
        or (recipient.status = 'processing' and recipient.claimed_at < now() - interval '10 minutes')
      )
    order by recipient.id
    for update skip locked
    limit p_limit
  )
  update public.crm_bulk_send_recipients recipient
  set status = 'processing',
      claim_token = gen_random_uuid(),
      claimed_at = now()
  from candidates
  where recipient.id = candidates.id
  returning recipient.id, recipient.client_id, recipient.email_message_id, recipient.claim_token;
end;
$$;

revoke all on function public.crm_claim_bulk_client_recipients(uuid, uuid, integer) from public;
grant execute on function public.crm_claim_bulk_client_recipients(uuid, uuid, integer) to service_role;

create or replace function public.crm_issue_client_unsubscribe_token(
  p_tenant_id uuid,
  p_bulk_send_id uuid,
  p_recipient_id uuid,
  p_client_id uuid
)
returns text
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_token text := p_recipient_id::text;
begin
  if not exists (
    select 1
    from public.crm_bulk_send_recipients recipient
    join public.crm_bulk_send_logs job
      on job.id = recipient.bulk_send_id
     and job.tenant_id = recipient.tenant_id
    where recipient.id = p_recipient_id
      and recipient.tenant_id = p_tenant_id
      and recipient.bulk_send_id = p_bulk_send_id
      and recipient.client_id = p_client_id
      and job.recipient_type = 'client'
      and job.content_mode = 'newsletter'
  ) then
    raise exception 'Newsletter recipient does not match the requested token context' using errcode = '42501';
  end if;

  insert into private.crm_client_unsubscribe_tokens (
    token_hash, tenant_id, client_id, bulk_send_id, recipient_id, expires_at
  ) values (
    encode(digest(v_token, 'sha256'), 'hex'),
    p_tenant_id,
    p_client_id,
    p_bulk_send_id,
    p_recipient_id,
    now() + interval '2 years'
  )
  on conflict (recipient_id) do update
  set expires_at = greatest(private.crm_client_unsubscribe_tokens.expires_at, excluded.expires_at),
      updated_at = now();

  return v_token;
end;
$$;

revoke all on function public.crm_issue_client_unsubscribe_token(uuid, uuid, uuid, uuid) from public;
grant execute on function public.crm_issue_client_unsubscribe_token(uuid, uuid, uuid, uuid) to service_role;

create or replace function public.crm_process_client_unsubscribe(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_token private.crm_client_unsubscribe_tokens%rowtype;
  v_prior public.client_contact_policy_enum;
begin
  if nullif(btrim(p_token), '') is null then
    return jsonb_build_object('outcome', 'invalid_token');
  end if;

  select *
    into v_token
  from private.crm_client_unsubscribe_tokens token
  where token.token_hash = encode(digest(btrim(p_token), 'sha256'), 'hex');

  if not found then
    return jsonb_build_object('outcome', 'invalid_token');
  end if;
  if v_token.expires_at < now() then
    return jsonb_build_object('outcome', 'expired_token');
  end if;

  select client.contact_policy
    into v_prior
  from public.clients client
  where client.id = v_token.client_id
    and client.tenant_id = v_token.tenant_id
  for update;

  if not found then
    return jsonb_build_object('outcome', 'invalid_token');
  end if;

  if v_prior <> 'do_not_contact' then
    update public.clients
    set contact_policy = 'do_not_contact',
        updated_at = now()
    where id = v_token.client_id
      and tenant_id = v_token.tenant_id;

    insert into public.crm_activity_events (
      tenant_id, client_id, event_type, old_value, new_value,
      metadata, created_by_profile_id
    ) values (
      v_token.tenant_id,
      v_token.client_id,
      'contact_policy_changed',
      v_prior::text,
      'do_not_contact',
      jsonb_build_object(
        'source', 'newsletter_unsubscribe',
        'bulk_send_id', v_token.bulk_send_id,
        'recipient_id', v_token.recipient_id
      ),
      null
    );
  end if;

  update private.crm_client_unsubscribe_tokens
  set used_at = coalesce(used_at, now()),
      updated_at = now()
  where id = v_token.id;

  return jsonb_build_object(
    'outcome', case when v_prior = 'do_not_contact' then 'already_unsubscribed' else 'unsubscribed' end
  );
end;
$$;

revoke all on function public.crm_process_client_unsubscribe(text) from public;
grant execute on function public.crm_process_client_unsubscribe(text) to service_role;
