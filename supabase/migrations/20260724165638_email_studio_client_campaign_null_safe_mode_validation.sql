create or replace function public.validate_crm_campaign_step_email_studio()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_template_id uuid;
begin
  if new.channel <> 'email' then
    if new.email_content_mode is not null
      or new.email_editor_document is not null
      or new.email_body_text is not null
      or new.email_preheader is not null
      or new.email_theme_key is not null
      or new.email_editor_schema_version is not null
      or new.email_render_hash is not null
      or new.email_template_version_id is not null then
      raise exception 'SMS campaign steps cannot contain Email Studio fields' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.email_editor_document is null then
    if new.email_content_mode is not null
      or new.email_body_text is not null
      or new.email_preheader is not null
      or new.email_theme_key is not null
      or new.email_editor_schema_version is not null
      or new.email_render_hash is not null
      or new.email_template_version_id is not null then
      raise exception 'Legacy email campaign steps cannot contain partial Email Studio fields' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.email_content_mode is distinct from 'campaign' then
    raise exception 'Client campaign Email Studio content must use campaign mode' using errcode = '23514';
  end if;

  if nullif(btrim(new.email_subject), '') is null then
    raise exception 'Canonical client campaign email subject is required' using errcode = '23514';
  end if;

  if new.email_template_version_id is not null then
    select version.template_id
      into v_template_id
    from public.crm_email_template_versions version
    where version.tenant_id = new.tenant_id
      and version.id = new.email_template_version_id
      and version.content_scope = 'client'
      and version.content_mode = 'campaign';

    if not found then
      raise exception 'Client campaign template version is invalid for this tenant and scope' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.validate_crm_campaign_step_email_studio() from public;
