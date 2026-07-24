alter table public.crm_campaign_steps
  drop constraint if exists crm_campaign_steps_email_content_mode_check;

alter table public.crm_campaign_steps
  add constraint crm_campaign_steps_email_content_mode_check
  check (email_content_mode is null or email_content_mode = 'campaign');

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

  if new.email_content_mode <> 'campaign' then
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

drop trigger if exists validate_crm_campaign_step_email_studio_trigger on public.crm_campaign_steps;

create trigger validate_crm_campaign_step_email_studio_trigger
before insert or update of
  tenant_id,
  channel,
  email_subject,
  email_content_mode,
  email_editor_document,
  email_body_text,
  email_preheader,
  email_theme_key,
  email_editor_schema_version,
  email_render_hash,
  email_template_version_id
on public.crm_campaign_steps
for each row execute function public.validate_crm_campaign_step_email_studio();

create or replace function public.crm_save_campaign_steps(
  p_campaign_id uuid,
  p_tenant_id uuid,
  p_steps jsonb
)
returns setof public.crm_campaign_steps
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_kept_ids uuid[];
  v_step jsonb;
  v_step_id uuid;
  v_step_order integer;
  v_channel text;
  v_signature_id uuid;
  v_template_version_id uuid;
  v_template_id uuid;
  v_actual_template_id uuid;
begin
  if not public.crm_has_role(auth.uid(), array['admin','staff'], p_tenant_id) then
    raise exception 'Not authorized for tenant %', p_tenant_id using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.crm_campaigns
    where id = p_campaign_id
      and tenant_id = p_tenant_id
  ) then
    raise exception 'Campaign not found' using errcode = '42704';
  end if;

  if jsonb_typeof(p_steps) <> 'array' then
    raise exception 'Campaign steps payload must be a JSON array' using errcode = '22023';
  end if;

  create temporary table if not exists pg_temp.crm_campaign_steps_input_ids (
    id uuid primary key,
    step_order integer unique
  ) on commit drop;

  truncate pg_temp.crm_campaign_steps_input_ids;

  for v_step in select value from jsonb_array_elements(p_steps)
  loop
    if jsonb_typeof(v_step) <> 'object' then
      raise exception 'Each campaign step must be a JSON object' using errcode = '22023';
    end if;

    v_step_id := nullif(v_step->>'id', '')::uuid;
    v_step_order := (v_step->>'step_order')::integer;
    v_channel := v_step->>'channel';

    if v_step_order is null or v_step_order < 1 then
      raise exception 'Campaign step order must be a positive integer' using errcode = '23514';
    end if;

    if v_channel not in ('email', 'sms') then
      raise exception 'Campaign step channel must be email or sms' using errcode = '23514';
    end if;

    insert into pg_temp.crm_campaign_steps_input_ids(id, step_order)
    values (coalesce(v_step_id, gen_random_uuid()), v_step_order);

    if v_step_id is not null and not exists (
      select 1
      from public.crm_campaign_steps
      where id = v_step_id
        and campaign_id = p_campaign_id
        and tenant_id = p_tenant_id
    ) then
      raise exception 'Campaign step % does not belong to this campaign and tenant', v_step_id using errcode = '42501';
    end if;

    v_signature_id := nullif(v_step->>'signature_id', '')::uuid;
    if v_signature_id is not null and not exists (
      select 1
      from public.crm_email_signatures
      where id = v_signature_id
        and tenant_id = p_tenant_id
    ) then
      raise exception 'Email signature is invalid for this tenant' using errcode = '23514';
    end if;

    v_template_version_id := nullif(v_step->>'email_template_version_id', '')::uuid;
    v_template_id := nullif(v_step->>'email_template_id', '')::uuid;

    if v_template_version_id is not null then
      select version.template_id
        into v_actual_template_id
      from public.crm_email_template_versions version
      where version.id = v_template_version_id
        and version.tenant_id = p_tenant_id
        and version.content_scope = 'client'
        and version.content_mode = 'campaign';

      if not found then
        raise exception 'Client campaign template version is invalid for this tenant and scope' using errcode = '23514';
      end if;

      if v_template_id is not null and v_template_id <> v_actual_template_id then
        raise exception 'Template and template-version identities do not match' using errcode = '23514';
      end if;
    elsif v_template_id is not null then
      raise exception 'Template identity requires a template version' using errcode = '23514';
    end if;
  end loop;

  select coalesce(array_agg((step->>'id')::uuid), array[]::uuid[])
    into v_kept_ids
  from jsonb_array_elements(p_steps) step
  where nullif(step->>'id', '') is not null;

  delete from public.crm_campaign_steps
  where campaign_id = p_campaign_id
    and tenant_id = p_tenant_id
    and not (id = any(v_kept_ids));

  insert into public.crm_campaign_steps (
    id,
    campaign_id,
    tenant_id,
    step_order,
    delay_days,
    delay_hours,
    channel,
    email_subject,
    email_body_html,
    email_body_text,
    email_preheader,
    email_content_mode,
    email_editor_document,
    email_theme_key,
    email_editor_schema_version,
    email_render_hash,
    email_template_version_id,
    sms_body_text,
    is_active,
    signature_id
  )
  select
    coalesce(nullif(step->>'id', '')::uuid, gen_random_uuid()),
    p_campaign_id,
    p_tenant_id,
    (step->>'step_order')::integer,
    coalesce((step->>'delay_days')::integer, 0),
    coalesce((step->>'delay_hours')::integer, 0),
    step->>'channel',
    case when step->>'channel' = 'email' then step->>'email_subject' end,
    case when step->>'channel' = 'email' then step->>'email_body_html' end,
    case when step->>'channel' = 'email' and step ? 'email_editor_document' then step->>'email_body_text' end,
    case when step->>'channel' = 'email' and step ? 'email_editor_document' then nullif(step->>'email_preheader', '') end,
    case when step->>'channel' = 'email' and step ? 'email_editor_document' then step->>'email_content_mode' end,
    case when step->>'channel' = 'email' and step ? 'email_editor_document' then step->'email_editor_document' end,
    case when step->>'channel' = 'email' and step ? 'email_editor_document' then step->>'email_theme_key' end,
    case when step->>'channel' = 'email' and step ? 'email_editor_document' then (step->>'email_editor_schema_version')::integer end,
    case when step->>'channel' = 'email' and step ? 'email_editor_document' then step->>'email_render_hash' end,
    case when step->>'channel' = 'email' and step ? 'email_editor_document' then nullif(step->>'email_template_version_id', '')::uuid end,
    case when step->>'channel' = 'sms' then step->>'sms_body_text' end,
    coalesce((step->>'is_active')::boolean, true),
    case when step->>'channel' = 'email' then nullif(step->>'signature_id', '')::uuid end
  from jsonb_array_elements(p_steps) step
  on conflict (id) do update set
    step_order = excluded.step_order,
    delay_days = excluded.delay_days,
    delay_hours = excluded.delay_hours,
    channel = excluded.channel,
    email_subject = excluded.email_subject,
    email_body_html = excluded.email_body_html,
    email_body_text = excluded.email_body_text,
    email_preheader = excluded.email_preheader,
    email_content_mode = excluded.email_content_mode,
    email_editor_document = excluded.email_editor_document,
    email_theme_key = excluded.email_theme_key,
    email_editor_schema_version = excluded.email_editor_schema_version,
    email_render_hash = excluded.email_render_hash,
    email_template_version_id = excluded.email_template_version_id,
    sms_body_text = excluded.sms_body_text,
    is_active = excluded.is_active,
    signature_id = excluded.signature_id,
    updated_at = now();

  return query
  select *
  from public.crm_campaign_steps
  where campaign_id = p_campaign_id
    and tenant_id = p_tenant_id
  order by step_order;
end;
$$;

revoke all on function public.crm_save_campaign_steps(uuid, uuid, jsonb) from public;
grant execute on function public.crm_save_campaign_steps(uuid, uuid, jsonb) to authenticated, service_role;
