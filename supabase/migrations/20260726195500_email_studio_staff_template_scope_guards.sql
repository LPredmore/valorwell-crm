-- Email Studio Pass 11: make shared template-version scope guards row-aware.

create or replace function private.enforce_email_template_version_reference_scope()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  version_id uuid;
  actual_scope text;
  expected_scope text := TG_ARGV[1];
  row_json jsonb := to_jsonb(new);
begin
  version_id := nullif(row_json ->> TG_ARGV[0], '')::uuid;
  if version_id is null then
    return new;
  end if;

  if expected_scope = '@recipient_type' then
    expected_scope := nullif(row_json ->> 'recipient_type', '');
  elsif expected_scope = '@email_message_source' then
    expected_scope := case
      when row_json ->> 'source' = 'staff_broadcast' then 'staff'
      else 'client'
    end;
  end if;

  if expected_scope not in ('client','relationship','staff') then
    raise exception 'Unable to resolve the expected email template scope for %.', tg_table_name;
  end if;

  select version.content_scope
    into actual_scope
  from public.crm_email_template_versions as version
  where version.tenant_id = new.tenant_id
    and version.id = version_id;

  if actual_scope is null then
    raise exception 'Email template version % does not exist in tenant %.', version_id, new.tenant_id;
  end if;

  if actual_scope <> expected_scope then
    raise exception 'Email template version % has scope %, expected %.', version_id, actual_scope, expected_scope;
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_email_template_version_reference_scope() from public, anon, authenticated;

drop trigger if exists enforce_crm_bulk_send_template_scope on public.crm_bulk_send_logs;
create trigger enforce_crm_bulk_send_template_scope
before insert or update of tenant_id, recipient_type, template_version_id
on public.crm_bulk_send_logs
for each row execute function private.enforce_email_template_version_reference_scope('template_version_id', '@recipient_type');

drop trigger if exists enforce_crm_email_message_template_scope on public.crm_email_messages;
create trigger enforce_crm_email_message_template_scope
before insert or update of tenant_id, source, template_version_id
on public.crm_email_messages
for each row execute function private.enforce_email_template_version_reference_scope('template_version_id', '@email_message_source');
