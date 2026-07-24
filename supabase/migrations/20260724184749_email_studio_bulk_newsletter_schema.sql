-- Email Studio Pass 9: schema, constraints, claims, and canonical-content trigger.

alter table public.crm_resend_email_settings add column if not exists postal_address text;

alter table public.crm_bulk_send_logs drop constraint if exists crm_bulk_send_logs_content_mode_check;
alter table public.crm_bulk_send_logs add constraint crm_bulk_send_logs_content_mode_check check (content_mode is null or content_mode = 'newsletter');

alter table public.crm_bulk_send_recipients
  add column if not exists email_message_id uuid references public.crm_email_messages(id) on delete set null,
  add column if not exists claim_token uuid,
  add column if not exists claimed_at timestamptz;

alter table public.crm_bulk_send_recipients drop constraint if exists crm_bulk_send_recipients_status_check;
alter table public.crm_bulk_send_recipients add constraint crm_bulk_send_recipients_status_check check (status = any (array['pending','processing','sent','failed']::text[]));

create unique index if not exists crm_bulk_send_recipients_bulk_client_key on public.crm_bulk_send_recipients(bulk_send_id, client_id);
create index if not exists crm_bulk_send_recipients_claim_queue_idx on public.crm_bulk_send_recipients(bulk_send_id, status, claimed_at, id);
create index if not exists crm_bulk_send_recipients_email_message_idx on public.crm_bulk_send_recipients(email_message_id) where email_message_id is not null;

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
create index if not exists crm_client_unsubscribe_tokens_tenant_client_idx on private.crm_client_unsubscribe_tokens(tenant_id, client_id, created_at desc);

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
    if new.content_mode is not null or new.preheader is not null or new.theme_key is not null or new.editor_schema_version is not null or new.render_hash is not null or new.template_version_id is not null then
      raise exception 'Legacy bulk sends cannot contain partial Email Studio fields' using errcode = '23514';
    end if;
    return new;
  end if;
  if new.recipient_type <> 'client' then raise exception 'Canonical Newsletter-mode bulk sends are client-only' using errcode = '23514'; end if;
  if new.content_mode is distinct from 'newsletter' then raise exception 'Canonical client bulk email must use newsletter mode' using errcode = '23514'; end if;
  if nullif(btrim(new.subject), '') is null or nullif(btrim(new.body_html), '') is null or nullif(btrim(new.body_text), '') is null then
    raise exception 'Canonical newsletter subject, HTML, and text are required' using errcode = '23514';
  end if;
  if not jsonb_path_exists(new.editor_document, '$.** ? (@.type == "emailStudioBlock" && @.attrs.kind == "compliance-footer")') then
    raise exception 'Canonical newsletters require a compliance footer block' using errcode = '23514';
  end if;
  if new.template_version_id is not null and not exists (
    select 1 from public.crm_email_template_versions version
    where version.tenant_id = new.tenant_id and version.id = new.template_version_id
      and version.content_scope = 'client' and version.content_mode = 'newsletter'
  ) then
    raise exception 'Newsletter template version is invalid for this tenant and scope' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_crm_bulk_send_email_studio() from public;
drop trigger if exists validate_crm_bulk_send_email_studio_trigger on public.crm_bulk_send_logs;
create trigger validate_crm_bulk_send_email_studio_trigger
before insert or update of tenant_id, recipient_type, subject, body_html, body_text, editor_document, preheader, content_mode, theme_key, editor_schema_version, render_hash, template_version_id
on public.crm_bulk_send_logs for each row execute function public.validate_crm_bulk_send_email_studio();
