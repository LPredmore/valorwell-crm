-- Dedicated social queue. All mutations use service-only SECURITY INVOKER RPCs.
-- n8n receives a narrowly scoped gateway credential, never the service-role key.
create table public.ai_operations_distribution_config (
  tenant_id uuid primary key references public.tenants(id),
  channel_id text not null,
  publishing_enabled boolean not null default false,
  baseline_completed_at timestamptz,
  monitor_cursor text,
  last_full_scan_at timestamptz,
  worker_token_hash text,
  created_at timestamptz not null default now()
);
create table public.ai_operations_distribution_destinations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  platform text not null check(platform in ('facebook','linkedin','instagram')),
  external_account_id text not null,
  display_name text not null,
  enabled boolean not null default false,
  credential_verified_at timestamptz,
  unique(tenant_id,platform,external_account_id), unique(tenant_id,id)
);
create table public.ai_operations_youtube_release_registry (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  channel_id text not null,
  youtube_video_id text not null check(youtube_video_id ~ '^[A-Za-z0-9_-]{11}$'),
  source_publication_id uuid references public.ai_operations_social_publications(id),
  clip_id uuid references public.ai_operations_video_clips(id),
  project_id uuid references public.ai_operations_video_projects(id),
  title text not null default '',
  video_url text not null,
  classification text not null default 'unknown' check(classification in ('short','long','unknown')),
  visibility text not null default 'unknown' check(visibility in ('public','private','unlisted','unknown','unavailable')),
  first_observed_at timestamptz not null default now(),
  first_public_at timestamptz,
  last_checked_at timestamptz,
  detection_method text not null default 'api',
  baseline_excluded boolean not null default false,
  excluded boolean not null default false,
  verification_requested_at timestamptz,
  unique(tenant_id,youtube_video_id), unique(tenant_id,id)
);
create index youtube_release_check_idx on public.ai_operations_youtube_release_registry(tenant_id,last_checked_at);
create index youtube_release_publication_idx on public.ai_operations_youtube_release_registry(source_publication_id);
create index youtube_release_clip_idx on public.ai_operations_youtube_release_registry(clip_id);
create index youtube_release_project_idx on public.ai_operations_youtube_release_registry(project_id);
create table public.ai_operations_distribution_overrides (
  tenant_id uuid not null,
  release_id uuid primary key,
  facebook_description text,
  linkedin_description text,
  instagram_description text,
  classification text check(classification in ('short','long','unknown')),
  drive_file_id text,
  updated_at timestamptz not null default now(),
  foreign key(tenant_id,release_id) references public.ai_operations_youtube_release_registry(tenant_id,id)
);
create table public.ai_operations_social_distribution_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  release_id uuid not null,
  youtube_video_id text not null,
  destination_id uuid not null,
  platform text not null check(platform in ('facebook','linkedin','instagram')),
  content_type text not null check(content_type in ('link','reel')),
  description_snapshot text,
  drive_file_id text,
  status text not null check(status in ('PENDING','PROCESSING','PUBLISHED','NEEDS_COPY','NEEDS_MEDIA','BLOCKED_AUTH','RETRY_WAIT','NEEDS_REVIEW','FAILED','SKIPPED_BASELINE')),
  attempt_count integer not null default 0,
  next_retry_at timestamptz,
  lease_token uuid,
  lease_expires_at timestamptz,
  request_started_at timestamptz,
  external_container_id text,
  external_post_id text,
  external_post_url text,
  published_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id,youtube_video_id,destination_id), unique(tenant_id,id),
  foreign key(tenant_id,release_id) references public.ai_operations_youtube_release_registry(tenant_id,id),
  foreign key(tenant_id,destination_id) references public.ai_operations_distribution_destinations(tenant_id,id),
  check((platform='instagram' and content_type='reel') or (platform<>'instagram' and content_type='link')),
  check(status<>'PUBLISHED' or (external_post_id is not null and published_at is not null))
);
create index social_distribution_queue_idx on public.ai_operations_social_distribution_deliveries(tenant_id,next_retry_at,created_at) where status in ('PENDING','RETRY_WAIT');
create index social_distribution_stale_idx on public.ai_operations_social_distribution_deliveries(lease_expires_at) where status='PROCESSING';
create index social_distribution_release_idx on public.ai_operations_social_distribution_deliveries(tenant_id,release_id);
create index social_distribution_destination_idx on public.ai_operations_social_distribution_deliveries(tenant_id,destination_id,created_at desc);
create table public.ai_operations_social_distribution_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  delivery_id uuid not null,
  attempt_number integer not null,
  lease_token uuid not null,
  worker_id text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  http_status integer,
  error_category text,
  outcome text not null default 'PROCESSING',
  external_post_id text,
  -- Deliberately no raw provider response, signed URL, headers, or tokens.
  unique(delivery_id,attempt_number),
  foreign key(tenant_id,delivery_id) references public.ai_operations_social_distribution_deliveries(tenant_id,id)
);
create index social_distribution_attempt_history_idx on public.ai_operations_social_distribution_attempts(tenant_id,delivery_id,started_at desc);

do $$ declare t text; begin
  foreach t in array array['ai_operations_distribution_config','ai_operations_distribution_destinations','ai_operations_youtube_release_registry','ai_operations_distribution_overrides','ai_operations_social_distribution_deliveries','ai_operations_social_distribution_attempts'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
    execute format('grant all on public.%I to service_role',t);
    if t <> 'ai_operations_distribution_config' then
      execute format('grant select on public.%I to authenticated',t);
      execute format('create policy tenant_admin_read on public.%I for select to authenticated using (public.is_tenant_admin((select auth.uid()),tenant_id))',t);
    end if;
  end loop;
end $$;

create function public.distribution_prepare(p_tenant uuid,p_release uuid)
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
    st:=case when r.baseline_excluded then 'SKIPPED_BASELINE'
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

create function public.distribution_observe(p_tenant uuid,p_video jsonb,p_method text default 'api')
returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare cfg record; pub record; clip record; rid uuid; is_baseline boolean; kind text;
begin
  select * into cfg from ai_operations_distribution_config where tenant_id=p_tenant for share;
  if not found or p_video->>'channel_id' is distinct from cfg.channel_id then raise exception 'channel_not_allowed'; end if;
  if p_video->>'visibility' not in ('public','private','unlisted','unavailable') then raise exception 'visibility_required'; end if;
  select * into pub from ai_operations_social_publications where tenant_id=p_tenant and platform='youtube' and external_video_id=p_video->>'id' order by created_at desc limit 1;
  select c.* into clip from ai_operations_video_clips c join ai_operations_video_projects p on p.id=c.project_id where c.id=pub.clip_id and p.tenant_id=p_tenant;
  kind:=case when clip.clip_type='short' then 'short' when clip.clip_type='part' or pub.source_type='project' then 'long' else 'unknown' end;
  is_baseline:=cfg.baseline_completed_at is null and p_video->>'visibility'='public';
  insert into ai_operations_youtube_release_registry(tenant_id,channel_id,youtube_video_id,source_publication_id,clip_id,project_id,title,video_url,classification,visibility,first_public_at,last_checked_at,detection_method,baseline_excluded)
  values(p_tenant,cfg.channel_id,p_video->>'id',pub.id,clip.id,pub.project_id,coalesce(p_video->>'title',''),'https://www.youtube.com/watch?v='||(p_video->>'id'),kind,p_video->>'visibility',case when p_video->>'visibility'='public' then now() end,now(),p_method,is_baseline)
  on conflict(tenant_id,youtube_video_id) do update set
    source_publication_id=coalesce(excluded.source_publication_id,ai_operations_youtube_release_registry.source_publication_id),
    clip_id=coalesce(excluded.clip_id,ai_operations_youtube_release_registry.clip_id), project_id=coalesce(excluded.project_id,ai_operations_youtube_release_registry.project_id),
    classification=case when excluded.classification<>'unknown' then excluded.classification else ai_operations_youtube_release_registry.classification end,
    title=excluded.title,visibility=excluded.visibility,last_checked_at=now(),verification_requested_at=null,
    first_public_at=coalesce(ai_operations_youtube_release_registry.first_public_at,excluded.first_public_at),
    baseline_excluded=ai_operations_youtube_release_registry.baseline_excluded or excluded.baseline_excluded
  returning id into rid;
  perform distribution_prepare(p_tenant,rid);
  return rid;
end $$;

create function public.distribution_claim(p_tenant uuid,p_worker text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare d ai_operations_social_distribution_deliveries; result jsonb;
begin
  if not exists(select 1 from ai_operations_distribution_config where tenant_id=p_tenant and publishing_enabled and baseline_completed_at is not null) then return null; end if;
  select j.* into d from ai_operations_social_distribution_deliveries j
  join ai_operations_distribution_destinations a on a.id=j.destination_id and a.tenant_id=j.tenant_id
  join ai_operations_youtube_release_registry r on r.id=j.release_id and r.tenant_id=j.tenant_id
  where j.tenant_id=p_tenant and j.status in ('PENDING','RETRY_WAIT') and (j.next_retry_at is null or j.next_retry_at<=now())
    and a.enabled and a.credential_verified_at is not null and r.visibility='public' and not r.baseline_excluded and not r.excluded
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
create function public.distribution_begin_request(p_tenant uuid,p_delivery uuid,p_lease uuid)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  update ai_operations_social_distribution_deliveries set request_started_at=now(),updated_at=now()
  where tenant_id=p_tenant and id=p_delivery and lease_token=p_lease and status='PROCESSING' and request_started_at is null and lease_expires_at>now()
    and exists(select 1 from ai_operations_distribution_config where tenant_id=p_tenant and publishing_enabled);
  return found;
end $$;

create function public.distribution_finish(p_tenant uuid,p_delivery uuid,p_lease uuid,p_outcome text,p_http integer default null,p_external_id text default null,p_url text default null,p_error text default null)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare d ai_operations_social_distribution_deliveries; final_status text;
begin
  select * into d from ai_operations_social_distribution_deliveries where tenant_id=p_tenant and id=p_delivery for update;
  if not found or d.lease_token is distinct from p_lease then return false; end if;
  if d.status='PUBLISHED' then return p_outcome='PUBLISHED' and d.external_post_id=p_external_id; end if;
  if d.status<>'PROCESSING' then return false; end if;
  if p_outcome not in ('PUBLISHED','BLOCKED_AUTH','NEEDS_REVIEW','NEEDS_MEDIA','FAILED','RETRY_WAIT') then raise exception 'invalid_outcome'; end if;
  if p_outcome='PUBLISHED' and (nullif(p_external_id,'') is null or d.request_started_at is null) then raise exception 'publication_proof_required'; end if;
  -- Only explicit rate-limit rejections or failures before send can retry automatically.
  if p_outcome='RETRY_WAIT' and d.request_started_at is not null and p_http is distinct from 429 then raise exception 'ambiguous_request_cannot_retry'; end if;
  final_status:=case when p_outcome='RETRY_WAIT' and d.attempt_count>=5 then 'FAILED' else p_outcome end;
  update ai_operations_social_distribution_deliveries set status=final_status,
    external_post_id=case when final_status='PUBLISHED' then p_external_id else external_post_id end,
    external_post_url=case when final_status='PUBLISHED' then p_url else external_post_url end,
    published_at=case when final_status='PUBLISHED' then now() else published_at end,
    next_retry_at=case when final_status='RETRY_WAIT' then now()+make_interval(secs=>least(1800,30*power(2,d.attempt_count))::integer) end,
    last_error=left(p_error,200),lease_expires_at=null,updated_at=now() where id=d.id;
  update ai_operations_social_distribution_attempts set completed_at=now(),http_status=p_http,error_category=left(p_error,200),outcome=final_status,external_post_id=p_external_id where delivery_id=d.id and attempt_number=d.attempt_count;
  return true;
end $$;

create function public.distribution_recover(p_tenant uuid)
returns integer language plpgsql security invoker set search_path=public,pg_temp as $$
declare d record; n integer:=0; st text;
begin
  for d in select * from ai_operations_social_distribution_deliveries where tenant_id=p_tenant and status='PROCESSING' and lease_expires_at<now() for update skip locked loop
    st:=case when d.request_started_at is not null then 'NEEDS_REVIEW' when d.attempt_count>=5 then 'FAILED' else 'RETRY_WAIT' end;
    update ai_operations_social_distribution_deliveries set status=st,next_retry_at=now()+interval '1 minute',last_error='worker_lease_expired',lease_expires_at=null,updated_at=now() where id=d.id;
    update ai_operations_social_distribution_attempts set completed_at=now(),outcome=st,error_category='worker_lease_expired' where delivery_id=d.id and attempt_number=d.attempt_count;
    n:=n+1;
  end loop;
  return n;
end $$;

-- A lightweight internal signal only; no HTTP call and no upload/status changes.
create function public.distribution_request_verification()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if new.platform='youtube' and new.external_video_id ~ '^[A-Za-z0-9_-]{11}$' then
    insert into ai_operations_youtube_release_registry(tenant_id,channel_id,youtube_video_id,source_publication_id,clip_id,project_id,video_url,verification_requested_at,detection_method)
    select new.tenant_id,c.channel_id,new.external_video_id,new.id,new.clip_id,new.project_id,'https://www.youtube.com/watch?v='||new.external_video_id,now(),'internal_event'
    from ai_operations_distribution_config c where c.tenant_id=new.tenant_id
    on conflict(tenant_id,youtube_video_id) do update set verification_requested_at=now();
  end if;
  return new;
end $$;
create trigger distribution_publication_signal after insert or update of external_video_id,status,desired_privacy_status on public.ai_operations_social_publications for each row execute function public.distribution_request_verification();

do $$ declare f record; begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('distribution_prepare','distribution_observe','distribution_claim','distribution_begin_request','distribution_finish','distribution_recover','distribution_request_verification') loop
    execute format('revoke all on function %s from public, anon, authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;

insert into public.ai_operations_distribution_config(tenant_id,channel_id) values('00000000-0000-0000-0000-000000000001','UCVcoBzMSzuABGxJ5Ne5EBtw');
insert into public.ai_operations_distribution_destinations(tenant_id,platform,external_account_id,display_name) values
('00000000-0000-0000-0000-000000000001','facebook','119382491255956','ValorWell Facebook Page'),
('00000000-0000-0000-0000-000000000001','linkedin','urn:li:organization:98694960','ValorWell LinkedIn Company'),
('00000000-0000-0000-0000-000000000001','linkedin','urn:li:person:CfHqw9H6zg','Optional LinkedIn Personal');
