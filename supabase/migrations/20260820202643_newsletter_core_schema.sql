-- Canonical newsletter data model. Delivery remains PRELAUNCH.

alter table private.crm_newsletter_runtime
  add column if not exists worker_release text,
  add column if not exists worker_deployed_at timestamptz,
  add column if not exists scheduler_installed_at timestamptz,
  add column if not exists activation_verified_at timestamptz;

alter table public.crm_newsletters
  add column if not exists editor_document jsonb,
  add column if not exists editor_schema_version integer,
  add column if not exists theme_key text,
  add column if not exists render_hash text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'crm_newsletters_editor_document_check' and conrelid = 'public.crm_newsletters'::regclass) then
    alter table public.crm_newsletters add constraint crm_newsletters_editor_document_check
      check (editor_document is null or (
        jsonb_typeof(editor_document) = 'object'
        and editor_document->>'type' = 'doc'
        and jsonb_typeof(editor_document->'content') = 'array'
      ));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_newsletters_editor_schema_version_check' and conrelid = 'public.crm_newsletters'::regclass) then
    alter table public.crm_newsletters add constraint crm_newsletters_editor_schema_version_check
      check (editor_schema_version is null or editor_schema_version > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_newsletters_render_hash_check' and conrelid = 'public.crm_newsletters'::regclass) then
    alter table public.crm_newsletters add constraint crm_newsletters_render_hash_check
      check (render_hash is null or render_hash ~ '^(sha256:[0-9a-f]{64}|fnv1a32:[0-9a-f]{8})$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_newsletters_canonical_content_check' and conrelid = 'public.crm_newsletters'::regclass) then
    alter table public.crm_newsletters add constraint crm_newsletters_canonical_content_check
      check (editor_document is null or (
        editor_schema_version is not null
        and nullif(btrim(coalesce(theme_key, '')), '') is not null
        and nullif(btrim(coalesce(render_hash, '')), '') is not null
        and nullif(btrim(coalesce(body_html, '')), '') is not null
        and nullif(btrim(coalesce(body_text, '')), '') is not null
      ));
  end if;
end
$$;

update public.crm_newsletters set status = 'completed' where status = 'sent';
alter table public.crm_newsletters drop constraint if exists crm_newsletters_status_check;
alter table public.crm_newsletters add constraint crm_newsletters_status_check
  check (status in ('draft', 'scheduled', 'sending', 'completed', 'cancelled'));

alter table public.crm_newsletter_suppressions
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_by_profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists revocation_reason text;

create index if not exists crm_newsletter_suppressions_active_mailbox_idx
  on public.crm_newsletter_suppressions (tenant_id, mailbox_key)
  where revoked_at is null;

alter table private.crm_newsletter_unsubscribe_tokens
  add column if not exists delivery_token text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'crm_newsletter_unsubscribe_tokens_recipient_key'
      and conrelid = 'private.crm_newsletter_unsubscribe_tokens'::regclass
  ) then
    alter table private.crm_newsletter_unsubscribe_tokens
      add constraint crm_newsletter_unsubscribe_tokens_recipient_key unique (recipient_id);
  end if;
end
$$;

create or replace function public.newsletter_mailbox_key(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_email is null then null
    when btrim(p_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$' then null
    else lower(btrim(p_email))
  end;
$$;

revoke all on function public.newsletter_mailbox_key(text) from public;
grant execute on function public.newsletter_mailbox_key(text) to anon, authenticated, service_role;
