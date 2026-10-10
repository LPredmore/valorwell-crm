create table public.ai_operations_distribution_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  delivery_id uuid not null,
  from_status text,
  to_status text not null,
  occurred_at timestamptz not null default now(),
  foreign key(tenant_id,delivery_id) references public.ai_operations_social_distribution_deliveries(tenant_id,id)
);
alter table public.ai_operations_distribution_events enable row level security;
revoke all on public.ai_operations_distribution_events from anon,authenticated;
grant select on public.ai_operations_distribution_events to authenticated;
grant all on public.ai_operations_distribution_events to service_role;
grant usage,select on sequence public.ai_operations_distribution_events_id_seq to service_role;
create policy distribution_event_admin_read on public.ai_operations_distribution_events for select to authenticated using (public.is_tenant_admin((select auth.uid()),tenant_id));
create index distribution_events_history_idx on public.ai_operations_distribution_events(tenant_id,delivery_id,occurred_at desc);
create function public.distribution_record_transition() returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if TG_OP='INSERT' then
    insert into ai_operations_distribution_events(tenant_id,delivery_id,to_status) values(new.tenant_id,new.id,new.status);
  elsif old.status is distinct from new.status then
    insert into ai_operations_distribution_events(tenant_id,delivery_id,from_status,to_status) values(new.tenant_id,new.id,old.status,new.status);
  end if;
  return new;
end $$;
create trigger distribution_transition_history after insert or update of status on public.ai_operations_social_distribution_deliveries for each row execute function public.distribution_record_transition();
revoke all on function public.distribution_record_transition() from public,anon,authenticated;
grant execute on function public.distribution_record_transition() to service_role;

-- Reconciliation can confirm an already-known platform ID; it cannot authorize resending.
create function public.distribution_confirm_existing(p_tenant uuid,p_delivery uuid,p_external_id text,p_url text)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare d ai_operations_social_distribution_deliveries;
begin
  select * into d from ai_operations_social_distribution_deliveries where tenant_id=p_tenant and id=p_delivery for update;
  if not found or d.status<>'NEEDS_REVIEW' or d.external_post_id is distinct from p_external_id or nullif(p_external_id,'') is null then return false; end if;
  update ai_operations_social_distribution_deliveries set status='PUBLISHED',published_at=coalesce(published_at,now()),external_post_url=p_url,updated_at=now(),last_error=null where id=d.id;
  update ai_operations_social_distribution_attempts set outcome='PUBLISHED',external_post_id=p_external_id,completed_at=coalesce(completed_at,now()) where delivery_id=d.id and attempt_number=d.attempt_count;
  return true;
end $$;
revoke all on function public.distribution_confirm_existing(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.distribution_confirm_existing(uuid,uuid,text,text) to service_role;
create or replace function public.distribution_finish(p_tenant uuid,p_delivery uuid,p_lease uuid,p_outcome text,p_http integer default null,p_external_id text default null,p_url text default null,p_error text default null)
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
    external_post_id=coalesce(nullif(p_external_id,''),external_post_id),
    external_post_url=case when final_status='PUBLISHED' then p_url else external_post_url end,
    published_at=case when final_status='PUBLISHED' then now() else published_at end,
    next_retry_at=case when final_status='RETRY_WAIT' then now()+make_interval(secs=>least(1800,30*power(2,d.attempt_count))::integer) end,
    last_error=left(p_error,200),lease_expires_at=null,updated_at=now() where id=d.id;
  update ai_operations_social_distribution_attempts set completed_at=now(),http_status=p_http,error_category=left(p_error,200),outcome=final_status,external_post_id=p_external_id where delivery_id=d.id and attempt_number=d.attempt_count;
  return true;
end $$;


