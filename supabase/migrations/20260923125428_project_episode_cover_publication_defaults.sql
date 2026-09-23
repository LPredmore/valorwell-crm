-- Match production migration 20260923125428. Only explicit full-episode cover art is inherited.
CREATE OR REPLACE FUNCTION private.ai_ops_social_prepare_publication()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_clip record;
  v_project_tenant uuid;
  v_episode_cover_file_id text;
  v_episode_cover_url text;
  v_settings record;
begin
  new.platform := coalesce(nullif(new.platform, ''), 'youtube');

  if new.source_type = 'clip' then
    if new.clip_id is null then
      raise exception 'clip_id is required when source_type=clip';
    end if;

    select
      c.project_id,
      c.clip_type,
      c.youtube_title,
      c.youtube_description,
      c.hashtags,
      c.cover_image_file_id,
      c.cover_image_url,
      p.tenant_id
    into v_clip
    from public.ai_operations_video_clips c
    join public.ai_operations_video_projects p on p.id = c.project_id
    where c.id = new.clip_id;

    if not found then
      raise exception 'clip % does not exist', new.clip_id;
    end if;

    new.project_id := v_clip.project_id;
    new.tenant_id := v_clip.tenant_id;
    new.content_format := case v_clip.clip_type
      when 'short' then 'short'
      when 'part' then 'long_form'
      else new.content_format
    end;

    if new.title is null then new.title := v_clip.youtube_title; end if;
    if coalesce(new.description, '') = '' then new.description := coalesce(v_clip.youtube_description, ''); end if;
    if coalesce(cardinality(new.hashtags), 0) = 0 then new.hashtags := coalesce(v_clip.hashtags, '{}'::text[]); end if;
    if new.thumbnail_file_id is null then new.thumbnail_file_id := v_clip.cover_image_file_id; end if;
    if new.thumbnail_url is null then new.thumbnail_url := v_clip.cover_image_url; end if;

  elsif new.source_type = 'project' then
    if new.project_id is null then
      raise exception 'project_id is required when source_type=project';
    end if;

    select p.tenant_id, p.cover_image_file_id, p.cover_image_url
    into v_project_tenant, v_episode_cover_file_id, v_episode_cover_url
    from public.ai_operations_video_projects p
    where p.id = new.project_id;

    if not found then
      raise exception 'project % does not exist', new.project_id;
    end if;

    new.tenant_id := v_project_tenant;
    new.clip_id := null;
    new.content_format := 'full_episode';
    -- Only explicit episode artwork may become the default YouTube thumbnail.
    -- Existing guest portraits are never used as episode covers.
    if new.thumbnail_file_id is null then new.thumbnail_file_id := v_episode_cover_file_id; end if;
    if new.thumbnail_url is null then new.thumbnail_url := v_episode_cover_url; end if;
  else
    raise exception 'Unsupported source_type: %', new.source_type;
  end if;

  if new.account_id is null then
    select a.id
    into new.account_id
    from public.ai_operations_social_accounts a
    where a.tenant_id = new.tenant_id
      and a.platform = new.platform
      and a.is_default
      and a.auth_status <> 'disabled'
    order by a.created_at
    limit 1;

    if new.account_id is null then
      raise exception 'No default % social account configured for tenant %', new.platform, new.tenant_id;
    end if;
  end if;

  select s.*
  into v_settings
  from public.ai_operations_social_settings s
  where s.account_id = new.account_id
    and s.tenant_id = new.tenant_id;

  if found then
    new.timezone := coalesce(v_settings.timezone, 'America/Chicago');
    new.category_id := coalesce(v_settings.default_category_id, '29');
    new.category_name := coalesce(v_settings.default_category_name, 'Nonprofits & Activism');
    new.default_language := coalesce(v_settings.default_language, 'en');
    new.license := coalesce(v_settings.default_license, 'youtube');
    new.made_for_kids := coalesce(v_settings.default_made_for_kids, false);
    new.contains_synthetic_media := coalesce(v_settings.default_contains_synthetic_media, false);
    new.embeddable := coalesce(v_settings.default_embeddable, true);
    new.public_stats_viewable := coalesce(v_settings.default_public_stats_viewable, true);
    new.notify_subscribers := coalesce(v_settings.default_notify_subscribers, true);
    if new.delivery_mode = 'immediate' then
      new.desired_privacy_status := coalesce(v_settings.default_immediate_privacy_status, 'public');
    end if;
  end if;

  return new;
end;
$function$

