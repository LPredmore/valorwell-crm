alter table public.ai_operations_distribution_config
  add column test_delivery_id uuid,
  add column test_approval_reference text,
  add constraint distribution_test_approval_required check(test_delivery_id is null or nullif(btrim(test_approval_reference),'') is not null),
  add constraint distribution_test_same_tenant foreign key(tenant_id,test_delivery_id) references public.ai_operations_social_distribution_deliveries(tenant_id,id);
create index distribution_test_delivery_idx on public.ai_operations_distribution_config(tenant_id,test_delivery_id);
alter table public.ai_operations_youtube_release_registry add column duration_seconds numeric check(duration_seconds>=0);
create or replace function public.distribution_observe(p_tenant uuid,p_video jsonb,p_method text default 'api')
returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare cfg record; pub record; clip record; rid uuid; is_baseline boolean; kind text;
begin
  select * into cfg from ai_operations_distribution_config where tenant_id=p_tenant for share;
  if not found or p_video->>'channel_id' is distinct from cfg.channel_id then raise exception 'channel_not_allowed'; end if;
  if p_video->>'visibility' not in ('public','private','unlisted','unavailable') then raise exception 'visibility_required'; end if;
  select * into pub from ai_operations_social_publications where tenant_id=p_tenant and platform='youtube' and external_video_id=p_video->>'id' order by created_at desc limit 1;
  select c.* into clip from ai_operations_video_clips c join ai_operations_video_projects p on p.id=c.project_id where c.id=pub.clip_id and p.tenant_id=p_tenant;
  kind:=case when clip.clip_type='short' then 'short' when clip.clip_type='part' or pub.source_type='project' or (p_video->>'duration_seconds')::numeric>180 then 'long' else 'unknown' end;
  is_baseline:=cfg.baseline_completed_at is null and p_video->>'visibility'='public';
  insert into ai_operations_youtube_release_registry(tenant_id,channel_id,youtube_video_id,source_publication_id,clip_id,project_id,title,video_url,classification,visibility,first_public_at,last_checked_at,detection_method,baseline_excluded,duration_seconds)
  values(p_tenant,cfg.channel_id,p_video->>'id',pub.id,clip.id,pub.project_id,coalesce(p_video->>'title',''),'https://www.youtube.com/watch?v='||(p_video->>'id'),kind,p_video->>'visibility',case when p_video->>'visibility'='public' then now() end,now(),p_method,is_baseline,(p_video->>'duration_seconds')::numeric)
  on conflict(tenant_id,youtube_video_id) do update set
    source_publication_id=coalesce(excluded.source_publication_id,ai_operations_youtube_release_registry.source_publication_id),
    clip_id=coalesce(excluded.clip_id,ai_operations_youtube_release_registry.clip_id), project_id=coalesce(excluded.project_id,ai_operations_youtube_release_registry.project_id),
    classification=case when excluded.classification<>'unknown' then excluded.classification else ai_operations_youtube_release_registry.classification end,
    duration_seconds=excluded.duration_seconds,title=excluded.title,visibility=excluded.visibility,last_checked_at=now(),verification_requested_at=null,
    first_public_at=coalesce(ai_operations_youtube_release_registry.first_public_at,excluded.first_public_at),
    baseline_excluded=ai_operations_youtube_release_registry.baseline_excluded or excluded.baseline_excluded
  returning id into rid;
  perform distribution_prepare(p_tenant,rid);
  return rid;
end $$;

create or replace function public.distribution_claim(p_tenant uuid,p_worker text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare d ai_operations_social_distribution_deliveries; result jsonb; cfg ai_operations_distribution_config;
begin
  select * into cfg from ai_operations_distribution_config where tenant_id=p_tenant;
  if not found or cfg.baseline_completed_at is null or (not cfg.publishing_enabled and cfg.test_delivery_id is null) then return null; end if;
  select j.* into d from ai_operations_social_distribution_deliveries j
  join ai_operations_distribution_destinations a on a.id=j.destination_id and a.tenant_id=j.tenant_id
  join ai_operations_youtube_release_registry r on r.id=j.release_id and r.tenant_id=j.tenant_id
  where j.tenant_id=p_tenant and (cfg.publishing_enabled or j.id=cfg.test_delivery_id) and j.status in ('PENDING','RETRY_WAIT') and (j.next_retry_at is null or j.next_retry_at<=now())
    and a.enabled and a.credential_verified_at is not null and r.visibility='public' and (not r.baseline_excluded or j.id=cfg.test_delivery_id) and not r.excluded
    and r.last_checked_at>now()-interval '10 minutes'
    and (j.platform<>'instagram' or coalesce((select o.classification from ai_operations_distribution_overrides o where o.release_id=r.id),r.classification)='short')
  order by j.created_at limit 1 for update of j skip locked;
  if not found then return null; end if;
  update ai_operations_social_distribution_deliveries set status='PROCESSING',attempt_count=attempt_count+1,lease_token=gen_random_uuid(),lease_expires_at=now()+interval '15 minutes',request_started_at=null,updated_at=now()
  where id=d.id returning * into d;
  insert into ai_operations_social_distribution_attempts(tenant_id,delivery_id,attempt_number,lease_token,worker_id) values(p_tenant,d.id,d.attempt_count,d.lease_token,left(p_worker,200));
  select to_jsonb(d)||jsonb_build_object('external_account_id',a.external_account_id,'video_url',r.video_url,'title',r.title) into result
  from ai_operations_distribution_destinations a,ai_operations_youtube_release_registry r where a.id=d.destination_id and r.id=d.release_id;
  return result;
end $$;

-- Commit the irreversible-request boundary BEFORE sending to a social platform.
create or replace function public.distribution_begin_request(p_tenant uuid,p_delivery uuid,p_lease uuid)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  update ai_operations_social_distribution_deliveries set request_started_at=now(),updated_at=now()
  where tenant_id=p_tenant and id=p_delivery and lease_token=p_lease and status='PROCESSING' and request_started_at is null and lease_expires_at>now()
    and exists(select 1 from ai_operations_distribution_config where tenant_id=p_tenant and (publishing_enabled or test_delivery_id=p_delivery));
  return found;
end $$;


create or replace function public.distribution_prepare(p_tenant uuid,p_release uuid)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare r record; a record; c record; o record; copy_text text; media text; kind text; st text;
begin
  select * into r from ai_operations_youtube_release_registry where tenant_id=p_tenant and id=p_release for update;
  if not found or r.visibility<>'public' or r.excluded then return; end if;
  select * into c from ai_operations_video_clips where id=r.clip_id;
  select * into o from ai_operations_distribution_overrides where tenant_id=p_tenant and release_id=p_release;
  kind:=coalesce(o.classification,r.classification);
  media:=coalesce(nullif(o.drive_file_id,''),c.drive_file_id);
  for a in select * from ai_operations_distribution_destinations where tenant_id=p_tenant loop
    if a.platform='instagram' and kind='long' then continue; end if;
    copy_text:=case a.platform when 'facebook' then coalesce(o.facebook_description,c.facebook_description) when 'linkedin' then coalesce(o.linkedin_description,c.linkedin_description) else coalesce(o.instagram_description,c.tiktok_description) end;
    st:=case when r.baseline_excluded and not exists(select 1 from ai_operations_distribution_config cfg join ai_operations_social_distribution_deliveries dj on dj.id=cfg.test_delivery_id and dj.tenant_id=cfg.tenant_id where cfg.tenant_id=p_tenant and dj.release_id=r.id and dj.destination_id=a.id) then 'SKIPPED_BASELINE'
      when a.platform='instagram' and kind<>'short' then 'NEEDS_REVIEW'
      when nullif(btrim(copy_text),'') is null then 'NEEDS_COPY'
      when a.platform='instagram' and nullif(media,'') is null then 'NEEDS_MEDIA'
      when a.credential_verified_at is null then 'BLOCKED_AUTH' else 'PENDING' end;
    insert into ai_operations_social_distribution_deliveries(tenant_id,release_id,youtube_video_id,destination_id,platform,content_type,description_snapshot,drive_file_id,status)
    values(p_tenant,r.id,r.youtube_video_id,a.id,a.platform,case when a.platform='instagram' then 'reel' else 'link' end,copy_text,media,st)
    on conflict(tenant_id,youtube_video_id,destination_id) do nothing;
    -- Only unattempted jobs may refresh copy automatically; sent/uncertain jobs are immutable.
    update ai_operations_social_distribution_deliveries set description_snapshot=copy_text,drive_file_id=media,status=st,updated_at=now()
    where tenant_id=p_tenant and release_id=r.id and destination_id=a.id and attempt_count=0 and status in ('NEEDS_COPY','NEEDS_MEDIA','BLOCKED_AUTH','NEEDS_REVIEW','PENDING');
  end loop;
end $$;


