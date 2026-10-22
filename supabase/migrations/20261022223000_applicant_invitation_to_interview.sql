-- Applicant-only Invitation to Interview campaign. Existing client campaigns remain unchanged.
-- Source: explicit 2026-10-22 clinician hiring workflow. No existing applicants are backfilled.
-- Installing this migration replaces the legacy new-applicant email+SMS insertion trigger.

-- Extend the authoritative applicant status enum without assuming its type name.
do $status$
declare v_schema text; v_type text;
begin
  select n.nspname, t.typname into v_schema,v_type
  from pg_attribute a join pg_class c on c.oid=a.attrelid
    join pg_namespace cn on cn.oid=c.relnamespace
    join pg_type t on t.oid=a.atttypid join pg_namespace n on n.oid=t.typnamespace
  where cn.nspname='public' and c.relname='provider_applicants'
    and a.attname='status' and not a.attisdropped;
  if v_type is null then raise exception 'Provider applicant status column not found'; end if;
  if exists(select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace
    where t.typname=v_type and n.nspname=v_schema and t.typtype='e') then
    execute format('ALTER TYPE %I.%I ADD VALUE IF NOT EXISTS %L',v_schema,v_type,'interview_scheduled');
  else
    raise exception 'Expected enum-backed applicant status, got %.%',v_schema,v_type;
  end if;
end $status$;

-- Reuse the existing service-role-only, leased, audited Resend transport outbox.
alter table public.crm_provider_applicant_communication_jobs
  drop constraint if exists crm_provider_applicant_jobs_kind_check;
alter table public.crm_provider_applicant_communication_jobs
  add constraint crm_provider_applicant_jobs_kind_check check
   (communication_kind in ('initial_email','initial_sms','interview_followup_2','interview_followup_3'));
alter table public.crm_provider_applicant_communication_jobs
  drop constraint if exists crm_provider_applicant_jobs_kind_channel_check;
alter table public.crm_provider_applicant_communication_jobs
  add constraint crm_provider_applicant_jobs_kind_channel_check check (
    (communication_kind='initial_sms' and channel='sms') or
    (communication_kind in ('initial_email','interview_followup_2','interview_followup_3') and channel='email')
  );

-- A separate applicant-specific campaign prevents accidental CLIENT enrollment.
create table if not exists public.crm_applicant_interview_enrollments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  applicant_id uuid not null references public.provider_applicants(id) on delete cascade,
  campaign_name text not null default 'Invitation to Interview'
    check (campaign_name='Invitation to Interview'),
  status text not null default 'active'
    check (status in ('active','completed','stopped')),
  stopped_reason text,
  started_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  unique (tenant_id,applicant_id)
);
create index if not exists crm_applicant_interview_enrollment_status_idx
  on public.crm_applicant_interview_enrollments (tenant_id,status,started_at);
create index if not exists crm_applicant_interview_enrollment_applicant_fk_idx
  on public.crm_applicant_interview_enrollments (applicant_id);
alter table public.crm_applicant_interview_enrollments enable row level security;
revoke all on public.crm_applicant_interview_enrollments from public,anon,authenticated;
grant all on public.crm_applicant_interview_enrollments to service_role;

-- Campaign is PAUSED after deployment. Only a CRM administrator can explicitly
-- activate this applicant-only program; do not use client campaign enrollment.
create table if not exists public.crm_applicant_interview_campaign_control (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  campaign_name text not null default 'Invitation to Interview'
    check (campaign_name = 'Invitation to Interview'),
  enabled boolean not null default false,
  updated_at timestamptz not null default clock_timestamp(),
  activated_by uuid references public.profiles(id) on delete set null
);
alter table public.crm_applicant_interview_campaign_control enable row level security;
revoke all on public.crm_applicant_interview_campaign_control from public,anon,authenticated;
grant all on public.crm_applicant_interview_campaign_control to service_role;
insert into public.crm_applicant_interview_campaign_control(tenant_id,enabled)
values('00000000-0000-0000-0000-000000000001'::uuid,false)
on conflict (tenant_id) do update set enabled=false, activated_by=null,updated_at=clock_timestamp();

-- This helper rounds any due timestamp forward to the next sendable instant
-- in America/Chicago, observing CST in winter and CDT in summer. Upper bound
-- 18:00 is exclusive to prevent a late-evening start.
create or replace function private.crm_applicant_interview_next_window(p_after timestamptz)
returns timestamptz language plpgsql immutable set search_path=''
as $fn$
declare v_local timestamp without time zone;
begin
 if p_after is null then return null; end if;
 v_local:=p_after at time zone 'America/Chicago';
 if v_local::time < time '06:00' then
   return (v_local::date+time '06:00') at time zone 'America/Chicago';
 elsif v_local::time >= time '18:00' then
   return ((v_local::date+1)+time '06:00') at time zone 'America/Chicago';
 end if;
 return p_after;
end; $fn$;
revoke all on function private.crm_applicant_interview_next_window(timestamptz)
 from public,anon,authenticated;

-- Read-only campaign state for the staff recruitment screen.
create or replace function public.crm_applicant_interview_campaign_status(p_tenant_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $fn$
declare v_context jsonb; v_on boolean;
begin
 v_context:=public.get_crm_operating_context();
 if auth.uid() is null or coalesce(v_context->>'current_tenant_id','')<>p_tenant_id::text
   or coalesce(v_context->>'crm_role','') not in ('crm_admin','crm_operator') then
   raise exception 'ROLE_DENIED' using errcode='42501';
 end if;
 perform private.valorwell_require_staff_contract(p_tenant_id,false);
 select c.enabled into v_on from public.crm_applicant_interview_campaign_control c
 where c.tenant_id=p_tenant_id;
 return jsonb_build_object(
   'name','Invitation to Interview',
   'enabled',coalesce(v_on,false),
   'initialDelayHours',2,
   'windowStart','06:00','windowEnd','18:00',
   'timezone','America/Chicago','steps',3
 );
end; $fn$;
revoke all on function public.crm_applicant_interview_campaign_status(uuid) from public,anon,authenticated;
grant execute on function public.crm_applicant_interview_campaign_status(uuid) to authenticated;

-- One explicitly authorized action changes campaign activation state.
create or replace function public.crm_set_applicant_interview_campaign_enabled(
 p_tenant_id uuid,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare v_context jsonb;
begin
 v_context:=public.get_crm_operating_context();
 if auth.uid() is null or p_enabled is null or
   coalesce(v_context->>'current_tenant_id','')<>p_tenant_id::text
   or coalesce(v_context->>'crm_role','')<>'crm_admin' then
   raise exception 'ROLE_DENIED' using errcode='42501';
 end if;
 perform private.valorwell_require_staff_contract(p_tenant_id,true);
 update public.crm_applicant_interview_campaign_control
 set enabled=p_enabled,updated_at=clock_timestamp(),
     activated_by=case when p_enabled then auth.uid() else null end
 where tenant_id=p_tenant_id;
 if not found then raise exception 'CAMPAIGN_NOT_CONFIGURED'; end if;
 return jsonb_build_object('name','Invitation to Interview','enabled',p_enabled);
end; $fn$;
revoke all on function public.crm_set_applicant_interview_campaign_enabled(uuid,boolean)
 from public,anon,authenticated;
grant execute on function public.crm_set_applicant_interview_campaign_enabled(uuid,boolean)
 to authenticated;

-- Only reliable staff identifiers count as an existing staff match.
-- We intentionally DO NOT use a similar name as proof of identity.
create or replace function private.crm_matching_staff_for_applicant(
 p_tenant uuid,p_email text,p_phone text
) returns uuid
language sql stable security definer set search_path=''
as $fn$
 select s.id from public.staff s
 left join public.profiles p on p.id=s.profile_id
 where s.tenant_id=p_tenant and (
   (nullif(lower(btrim(coalesce(p_email,''))),'') is not null and (
      lower(btrim(coalesce(p.email,'')))=lower(btrim(p_email))
      or lower(btrim(coalesce(to_jsonb(s)->>'prov_email','')))=lower(btrim(p_email))
   ))
   or (length(regexp_replace(coalesce(p_phone,''),'\D','','g'))>=10
    and right(regexp_replace(coalesce(s.prov_phone,''),'\D','','g'),10)
       =right(regexp_replace(p_phone,'\D','','g'),10)
    and length(regexp_replace(coalesce(s.prov_phone,''),'\D','','g'))>=10)
 ) order by s.id limit 1;
$fn$;
revoke all on function private.crm_matching_staff_for_applicant(uuid,text,text)
 from public,anon,authenticated;

-- Send eligibility must be revalidated before EACH email, not only enrollment.
create or replace function public.crm_applicant_interview_can_send(p_applicant_id uuid)
returns boolean language plpgsql stable security definer set search_path=''
as $fn$
declare a public.provider_applicants%rowtype;
begin
 if not private.valorwell_is_service_role() then
   raise exception 'ROLE_DENIED' using errcode='42501';
 end if;
 select * into a from public.provider_applicants where id=p_applicant_id;
 if not found or a.closed_at is not null or a.converted_staff_id is not null
   or a.status::text not in ('new','contacted') or nullif(btrim(a.email),'') is null
 then return false; end if;
 if not exists (select 1 from public.crm_applicant_interview_campaign_control ctl
   where ctl.tenant_id=a.tenant_id and ctl.enabled=true) then return false; end if;
 if private.crm_matching_staff_for_applicant(a.tenant_id,a.email,a.phone) is not null then
   return false;
 end if;
 if not exists (select 1 from public.crm_applicant_interview_enrollments e
   where e.tenant_id=a.tenant_id and e.applicant_id=a.id and e.status='active') then
   return false;
 end if;
 if exists (select 1 from public.clinician_interview_bookings b
   where b.tenant_id=a.tenant_id and b.applicant_id=a.id
     and b.status in ('reserving','confirmed','attention')) then
   return false;
 end if;
 return true;
end; $fn$;
revoke all on function public.crm_applicant_interview_can_send(uuid) from public,anon,authenticated;
grant execute on function public.crm_applicant_interview_can_send(uuid) to service_role;

-- Grandfather historic manually invited applicants so a new access gate does
-- not revoke interviews already offered before the automation cutover.
create table if not exists public.crm_applicant_interview_cutovers (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  started_at timestamptz not null default clock_timestamp()
);
alter table public.crm_applicant_interview_cutovers enable row level security;
revoke all on public.crm_applicant_interview_cutovers from public,anon,authenticated;
grant all on public.crm_applicant_interview_cutovers to service_role;
insert into public.crm_applicant_interview_cutovers(tenant_id)
values ('00000000-0000-0000-0000-000000000001'::uuid)
on conflict (tenant_id) do nothing;

-- The public interview scheduler is email-gated, but membership in the
-- applicant campaign is the additional server-side prerequisite. Existing staff
-- reapplications are not granted scheduling access even if they know the URL.
create or replace function public.crm_applicant_interview_can_access(p_applicant_id uuid)
returns boolean language plpgsql stable security definer set search_path=''
as $fn$
declare a public.provider_applicants%rowtype;
begin
 if not private.valorwell_is_service_role() then
   raise exception 'ROLE_DENIED' using errcode='42501';
 end if;
 select * into a from public.provider_applicants where id=p_applicant_id;
 if not found or a.closed_at is not null or a.converted_staff_id is not null
    or a.status::text in ('declined','withdrawn','hired','inactive','no_response')
 then return false; end if;
 if private.crm_matching_staff_for_applicant(a.tenant_id,a.email,a.phone) is not null
 then return false; end if;
 return exists (select 1 from public.crm_applicant_interview_enrollments e
    where e.applicant_id=a.id and e.tenant_id=a.tenant_id)
  or a.created_at < (select c.started_at from public.crm_applicant_interview_cutovers c
      where c.tenant_id=a.tenant_id);
end; $fn$;
revoke all on function public.crm_applicant_interview_can_access(uuid) from public,anon,authenticated;
grant execute on function public.crm_applicant_interview_can_access(uuid) to service_role;

-- A genuine new application receives EITHER an owner-only task OR a campaign enrollment.
-- Do not modify staff status, and never email or text staff reapplicants.
create or replace function private.crm_enqueue_provider_applicant_initial_contact()
returns trigger language plpgsql security definer set search_path=''
as $fn$
declare v_match uuid; v_owner uuid;
begin
 if new.status::text<>'new' or new.closed_at is not null then return new; end if;
 v_match:=coalesce(new.converted_staff_id,
   private.crm_matching_staff_for_applicant(new.tenant_id,new.email,new.phone));
 if v_match is not null or nullif(btrim(coalesce(new.email,'')),'') is null
    or new.email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+[.][A-Z]{2,}$' then
   select s.profile_id into v_owner from public.staff s
    where s.id='af790579-5d4c-4aed-9d2e-77d72908ed85'::uuid
      and s.tenant_id=new.tenant_id;
   if v_owner is null then
     raise exception 'Clinician duplicate review task owner is not configured';
   end if;
   insert into public.crm_tasks(
     tenant_id,title,description,type,priority,status,owner_id,created_by_profile_id,
     staff_id,due_at,tags
   ) values (
     new.tenant_id,
     case when v_match is null then 'Review applicant without a usable email address'
       else 'Review existing staff member who reapplied to ValorWell' end,
     concat('Applicant: ',concat_ws(' ',new.first_name,new.last_name),
       E'\nApplication ID: ',new.id::text,E'\nEmail: ',coalesce(new.email,''),
       E'\nPhone: ',coalesce(new.phone,''),
       E'\nMatched staff ID: ',coalesce(v_match::text,'(none)'),
       E'\nDo not automatically change their staff or applicant status. Review and follow up manually.'),
     'staff_follow_up','high','not_started',v_owner,v_owner,v_match,
     clock_timestamp()+interval '1 day',array['clinician-reapplication','manual-review']
   );
   return new;
 end if;
 if not exists (select 1 from public.crm_applicant_interview_campaign_control ctl
    where ctl.tenant_id=new.tenant_id and ctl.enabled=true) then
   return new;
 end if;
 insert into public.crm_applicant_interview_enrollments(tenant_id,applicant_id)
 values (new.tenant_id,new.id)
 on conflict (tenant_id,applicant_id) do nothing;
 insert into public.crm_provider_applicant_communication_jobs (
   tenant_id,applicant_id,communication_kind,channel,content_version,scheduled_for,idempotency_key
 ) values (
   new.tenant_id,new.id,'initial_email','email','interview_invitation_v1',
   private.crm_applicant_interview_next_window(
     greatest(new.created_at+interval '2 hours',clock_timestamp())
   ),'provider-applicant/'||new.id::text||'/interview/1'
 ) on conflict (tenant_id,idempotency_key) do nothing;
 return new;
end; $fn$;
-- The original AFTER INSERT trigger calls this same function and remains installed.

-- Chain follow-ups AFTER successful provider acceptance; delays are relative to
-- the actual previous email, not merely the planned send time.
create or replace function private.crm_chain_applicant_interview_followups()
returns trigger language plpgsql security definer set search_path=''
as $fn$
declare v_next text;v_delay interval;
begin
 if old.status='sent' or new.status<>'sent'
    or new.content_version<>'interview_invitation_v1' then return new; end if;
 if new.communication_kind='initial_email' then
   v_next:='interview_followup_2'; v_delay:=interval '2 days';
 elsif new.communication_kind='interview_followup_2' then
   v_next:='interview_followup_3'; v_delay:=interval '7 days';
 elsif new.communication_kind='interview_followup_3' then
   update public.crm_applicant_interview_enrollments
     set status='completed',completed_at=clock_timestamp(),updated_at=clock_timestamp()
   where tenant_id=new.tenant_id and applicant_id=new.applicant_id and status='active';
   return new;
 else return new; end if;
 if public.crm_applicant_interview_can_send(new.applicant_id) then
   insert into public.crm_provider_applicant_communication_jobs (
      tenant_id,applicant_id,communication_kind,channel,content_version,scheduled_for,idempotency_key
   ) values (
      new.tenant_id,new.applicant_id,v_next,'email','interview_invitation_v1',
      private.crm_applicant_interview_next_window(coalesce(new.sent_at,clock_timestamp())+v_delay),
      'provider-applicant/'||new.applicant_id::text||'/interview/'||
        case when v_next='interview_followup_2' then '2' else '3' end
   ) on conflict (tenant_id,idempotency_key) do nothing;
 end if;
 return new;
end; $fn$;
drop trigger if exists crm_chain_applicant_interview_followups
 on public.crm_provider_applicant_communication_jobs;
create trigger crm_chain_applicant_interview_followups
 after update of status on public.crm_provider_applicant_communication_jobs
 for each row execute function private.crm_chain_applicant_interview_followups();

-- Respect later staff decisions and closed applications as campaign exits.
-- Changing an applicant outside New/Contacted never restarts outreach.
create or replace function private.crm_stop_applicant_interview_for_status()
returns trigger language plpgsql security definer set search_path=''
as $fn$
begin
 if new.status::text not in ('new','contacted')
     or new.closed_at is not null or new.converted_staff_id is not null then
   update public.crm_applicant_interview_enrollments
      set status='stopped',stopped_reason='applicant_status_changed',
          updated_at=clock_timestamp()
    where applicant_id=new.id and tenant_id=new.tenant_id and status='active';
   update public.crm_provider_applicant_communication_jobs
      set status='cancelled',claim_token=null,claimed_at=null,
          error_code='applicant_status_changed',updated_at=clock_timestamp()
    where applicant_id=new.id and tenant_id=new.tenant_id
      and content_version='interview_invitation_v1'
      and status in ('scheduled','failed');
 end if;
 return new;
end; $fn$;
drop trigger if exists crm_stop_applicant_interview_for_status on public.provider_applicants;
create trigger crm_stop_applicant_interview_for_status
 after update of status,closed_at,converted_staff_id on public.provider_applicants
 for each row execute function private.crm_stop_applicant_interview_for_status();

-- Booking confirmation is the authoritative appointment event.
-- The scheduled interview stage is not set until the Google Calendar event
-- has been committed to the booking table as confirmed.
create or replace function private.crm_applicant_interview_booking_confirmed()
returns trigger language plpgsql security definer set search_path=''
as $fn$
begin
 if new.status='confirmed' and old.status is distinct from 'confirmed' then
   update public.crm_applicant_interview_enrollments
      set status='stopped',stopped_reason='interview_scheduled',
          updated_at=clock_timestamp()
    where tenant_id=new.tenant_id and applicant_id=new.applicant_id and status='active';
   update public.crm_provider_applicant_communication_jobs
      set status='cancelled',claim_token=null,claimed_at=null,
          error_code='interview_booked',error_detail='Interview successfully scheduled',
          updated_at=clock_timestamp()
    where tenant_id=new.tenant_id and applicant_id=new.applicant_id
      and content_version='interview_invitation_v1'
      and status in ('scheduled','failed');
   update public.provider_applicants
      set status='interview_scheduled',next_action='Attend scheduled ValorWell clinician interview',
          next_action_due_at=new.starts_at,last_activity_at=clock_timestamp()
    where id=new.applicant_id and tenant_id=new.tenant_id
      and closed_at is null and converted_staff_id is null
      and status::text in ('new','contacted')
      and private.crm_matching_staff_for_applicant(tenant_id,email,phone) is null;
 end if;
 return new;
end; $fn$;
drop trigger if exists crm_applicant_interview_booking_confirmed
 on public.clinician_interview_bookings;
create trigger crm_applicant_interview_booking_confirmed
 after update of status on public.clinician_interview_bookings
 for each row execute function private.crm_applicant_interview_booking_confirmed();

-- Append stage without renumbering existing stage IDs. Note that position is
-- a UI order, not the source applicant status.
do $stage$
declare v_pipeline uuid:='197bfeb7-a1d2-4c26-842f-045b5256d9e4';
declare v_tenant uuid:='00000000-0000-0000-0000-000000000001';
begin
 if not exists(select 1 from public.crm_pipelines where id=v_pipeline
   and tenant_id=v_tenant and source_key='provider_applicants') then
   raise exception 'Unexpected clinician pipeline tenant/source';
 end if;
 if not exists(select 1 from public.crm_pipeline_stages
    where pipeline_id=v_pipeline and source_stage_key='interview_scheduled') then
   update public.crm_pipeline_stages set position=position+100
     where pipeline_id=v_pipeline and position>=10;
   update public.crm_pipeline_stages set position=position-99
     where pipeline_id=v_pipeline and position>=110;
   insert into public.crm_pipeline_stages (
     tenant_id,pipeline_id,name,position,is_terminal,source_stage_key
   ) values (v_tenant,v_pipeline,'Interview Scheduled',10,false,'interview_scheduled');
 end if;
end $stage$;
