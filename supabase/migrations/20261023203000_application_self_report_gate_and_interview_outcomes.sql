-- Automatic post-submission qualification, stage-safe interview outcomes.
-- Only self-reported NPI, licensed state/number, and current applicable professional disclosures.
-- Does not verify licensing registries and does not create staff profiles or invitations.
alter type public.provider_applicant_status_enum add value if not exists 'interview_completed' after 'interview_scheduled';
alter type public.provider_applicant_status_enum add value if not exists 'accepted' after 'interview_completed';

create or replace function private.crm_professional_application_qualification(
  p_application public.therapist_applications)
returns jsonb
language plpgsql stable
set search_path = ''
as $fn$
declare
  v_npi boolean := false;
  v_license boolean := false;
  v_disclosures boolean := false;
  v_board text;
  v_question integer;
begin
  v_npi := coalesce(p_application.npi_declared,false)
    and coalesce(p_application.npi,'') ~ '^[0-9]{10}$';
  v_license := nullif(btrim(coalesce(p_application.license_category,'')),'') is not null
    and exists (
      select 1 from unnest(coalesce(p_application.states, array[]::text[])) as s(state)
      where nullif(btrim(coalesce(p_application.license_numbers ->> s.state,'')),'') is not null
    );
  v_board := p_application.details #>> '{disclosures,boardCertified}';
  v_disclosures := v_board in ('true','false');
  if v_disclosures then
    for v_question in 1..14 loop
      if (p_application.details #>> array['disclosures','answers',v_question::text,'answer'])
          is distinct from 'false' then
        v_disclosures := false;
        exit;
      end if;
    end loop;
  end if;
  if v_disclosures and v_board='true' then
    for v_question in 21..22 loop
      if (p_application.details #>> array['disclosures','answers',v_question::text,'answer'])
          is distinct from 'false' then
        v_disclosures := false;
        exit;
      end if;
    end loop;
  end if;
  return jsonb_build_object(
    'npi',v_npi,'license',v_license,'disclosures',v_disclosures,
    'qualified',(v_npi and v_license and v_disclosures));
end;
$fn$;

-- Trigger exists already: crm_therapist_application_submitted AFTER UPDATE OF status.
create or replace function private.crm_therapist_application_submitted()
returns trigger language plpgsql security definer set search_path = ''
as $fn$
declare
  v_result jsonb;
  v_applicant uuid;
  v_stage text;
begin
  if old.status is distinct from 'submitted' and new.status='submitted'
     and new.provider_applicant_id is not null then
    v_result := private.crm_professional_application_qualification(new);
    v_stage := case when (v_result->>'qualified')::boolean
      then 'interview_invited' else 'screening' end;
    update public.provider_applicants a
      set status=v_stage::public.provider_applicant_status_enum,
          next_action=case when v_stage='screening'
            then 'Review NPI, license or professional disclosures before interview'
            else 'Await interview invitation delivery and scheduling' end,
          next_action_due_at=case when v_stage='screening'
            then clock_timestamp()+interval '1 day'
            else greatest(new.completed_at+interval '2 hours',clock_timestamp()) end,
          last_activity_at=clock_timestamp()
    where a.id=new.provider_applicant_id
      and a.tenant_id=new.tenant_id
      and a.source='website'
      and a.source_record_key=new.source_submission_id::text
      and lower(a.email)=lower(new.email)
      and a.status::text in ('new','contacted','application','no_response')
      and a.closed_at is null and a.converted_staff_id is null
    returning a.id into v_applicant;
    if v_applicant is not null then
      insert into public.provider_applicant_activity_events
        (tenant_id,applicant_id,event_type,metadata,occurred_at)
      values
        (new.tenant_id,v_applicant,'application_auto_qualified',
         jsonb_build_object('applicationId',new.id,'status',v_stage,'checks',v_result,
                            'basis','self_report_only'),
         clock_timestamp());
    end if;
  end if;
  return new;
end;
$fn$;

-- Qualified submissions and manually cleared Screening cases enter interview_invited
-- BEFORE the email campaign runs. Unqualified Screening never receives an invitation.
create or replace function private.crm_start_screening_interview_campaign()
returns trigger language plpgsql security definer set search_path = ''
as $fn$
declare v_application public.therapist_applications%rowtype;
begin
  if new.status::text<>'interview_invited'
     or old.status::text='interview_invited'
     or new.closed_at is not null or new.converted_staff_id is not null
     or nullif(btrim(new.email),'') is null then
    return new;
  end if;
  if not exists (
    select 1 from public.crm_screening_interview_campaign_control c
    where c.tenant_id=new.tenant_id and c.enabled
      and c.activated_at is not null and clock_timestamp()>=c.activated_at
  ) then return new; end if;
  if private.crm_matching_staff_for_applicant(new.tenant_id,new.email,new.phone) is not null
  then return new; end if;
  if exists (
    select 1 from public.clinician_interview_bookings b
    where b.tenant_id=new.tenant_id and b.applicant_id=new.id
      and b.status in ('reserving','confirmed','attention')
  ) then return new; end if;
  select * into v_application from public.therapist_applications t
    where t.tenant_id=new.tenant_id and t.provider_applicant_id=new.id
      and lower(t.email)=lower(new.email) and t.status='submitted'
      and t.completed_at is not null
    order by t.completed_at desc limit 1;
  if not found then return new; end if;
  insert into public.crm_screening_interview_jobs
    (tenant_id,applicant_id,application_id,step,due_at)
  values (new.tenant_id,new.id,v_application.id,1,
    private.crm_applicant_interview_next_window(
      greatest(v_application.completed_at + interval '2 hours',clock_timestamp())))
  on conflict (applicant_id,application_id,step) do nothing;
  return new;
end;
$fn$;

-- Worker authorization: step one now requires interview_invited, not screening.
create or replace function public.crm_claim_screening_interview_jobs(p_limit integer default 10)
returns table(id uuid,applicant_id uuid,tenant_id uuid,step smallint,claim_token uuid)
language plpgsql security definer set search_path = ''
as $fn$
begin
  if not private.valorwell_is_service_role() then
    raise exception 'ROLE_DENIED' using errcode='42501';
  end if;
  if (clock_timestamp() at time zone 'America/Chicago')::time < time '06:00'
     or (clock_timestamp() at time zone 'America/Chicago')::time >= time '18:00'
  then return; end if;
  return query with todo as (
    select j.id from public.crm_screening_interview_jobs j
    join public.crm_screening_interview_campaign_control c on c.tenant_id=j.tenant_id
    join public.provider_applicants a on a.id=j.applicant_id and a.tenant_id=j.tenant_id
    join public.therapist_applications t on t.id=j.application_id and t.tenant_id=j.tenant_id
    where c.enabled and c.activated_at is not null and j.created_at>=c.activated_at
      and a.closed_at is null and a.converted_staff_id is null
      and a.status::text='interview_invited'
      and nullif(btrim(a.email),'') is not null
      and lower(a.email)=lower(t.email)
      and t.status='submitted' and t.completed_at is not null
      and private.crm_matching_staff_for_applicant(a.tenant_id,a.email,a.phone) is null
      and not exists (
        select 1 from public.clinician_interview_bookings b
        where b.tenant_id=j.tenant_id and b.applicant_id=j.applicant_id
          and b.status in ('reserving','confirmed','attention')
      )
      and (
        (j.status in ('scheduled','failed') and j.due_at<=clock_timestamp()
         and j.attempt_count<j.max_attempts)
        or (j.status='processing' and j.claimed_at<clock_timestamp()-interval '15 minutes'
         and j.attempt_count<j.max_attempts)
      )
    order by j.due_at,j.created_at for update of j skip locked
    limit greatest(1,least(coalesce(p_limit,10),25))
  ),claimed as (
    update public.crm_screening_interview_jobs j
      set status='processing',claim_token=gen_random_uuid(),claimed_at=clock_timestamp(),
          attempt_count=attempt_count+1,updated_at=clock_timestamp()
      from todo where j.id=todo.id returning j.*
  )
  select claimed.id,claimed.applicant_id,claimed.tenant_id,claimed.step,claimed.claim_token
  from claimed;
end;
$fn$;

create or replace function public.crm_screening_interview_can_send(p_job_id uuid,p_token uuid)
returns boolean language plpgsql stable security definer set search_path = ''
as $fn$
begin
  if not private.valorwell_is_service_role() then
    raise exception 'ROLE_DENIED' using errcode='42501';
  end if;
  return exists (
    select 1 from public.crm_screening_interview_jobs j
    join public.provider_applicants a on a.id=j.applicant_id and a.tenant_id=j.tenant_id
    join public.therapist_applications t on t.id=j.application_id and t.tenant_id=j.tenant_id
    join public.crm_screening_interview_campaign_control c on c.tenant_id=j.tenant_id
    where j.id=p_job_id and j.claim_token=p_token and j.status='processing'
      and c.enabled and c.activated_at is not null and j.created_at>=c.activated_at
      and (clock_timestamp() at time zone 'America/Chicago')::time>=time '06:00'
      and (clock_timestamp() at time zone 'America/Chicago')::time<time '18:00'
      and a.status::text='interview_invited' and a.closed_at is null
      and a.converted_staff_id is null
      and lower(a.email)=lower(t.email) and t.status='submitted'
      and t.completed_at is not null
      and private.crm_matching_staff_for_applicant(a.tenant_id,a.email,a.phone) is null
      and not exists (
        select 1 from public.clinician_interview_bookings b
        where b.tenant_id=j.tenant_id and b.applicant_id=j.applicant_id
          and b.status in ('reserving','confirmed','attention')
      )
  );
end;
$fn$;

-- Staff-only audited manual outcome; no staff, credentialing or onboarding mutation.
create or replace function public.crm_record_applicant_interview_stage(
  p_applicant_id uuid, p_to_status text, p_prior_version bigint,
  p_client_action_id uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = ''
as $fn$
declare
  v_applicant public.provider_applicants%rowtype;
  v_actor uuid;
  v_status text := lower(btrim(coalesce(p_to_status,'')));
  v_note text := nullif(btrim(coalesce(p_note,'')),'');
begin
  if p_applicant_id is null or p_prior_version is null or p_client_action_id is null
     or v_note is null or length(v_note)<8 then
    raise exception 'MISSING_PREREQUISITE' using errcode='22023';
  end if;
  select * into v_applicant from public.provider_applicants
    where id=p_applicant_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  v_actor := private.valorwell_require_staff_contract(v_applicant.tenant_id,true);
  if exists (
    select 1 from public.provider_applicant_activity_events
    where tenant_id=v_applicant.tenant_id and client_action_id=p_client_action_id
  ) then
    return jsonb_build_object('id',v_applicant.id,'version',v_applicant.version,'idempotent',true);
  end if;
  if v_applicant.version<>p_prior_version then
    raise exception 'STALE_VERSION' using errcode='40001';
  end if;
  if v_applicant.closed_at is not null or v_applicant.converted_staff_id is not null
  then raise exception 'APPLICANT_CLOSED' using errcode='23514'; end if;
  if not (
    (v_applicant.status::text='screening' and v_status='interview_invited')
    or (v_applicant.status::text='interview_scheduled' and v_status in ('interview_completed','accepted'))
    or (v_applicant.status::text='interview_completed' and v_status='accepted')
  ) then
    raise exception 'INVALID_TRANSITION' using errcode='23514';
  end if;
  update public.provider_applicants a
    set status=v_status::public.provider_applicant_status_enum,
        next_action=case
          when v_status='interview_invited' then 'Await invitation delivery and interview scheduling'
          when v_status='interview_completed' then 'Record final clinician interview decision'
          else 'Accepted — onboarding design pending separate implementation' end,
        next_action_due_at=case
          when v_status='interview_invited' then clock_timestamp()+interval '2 hours'
          else clock_timestamp()+interval '2 days' end,
        last_activity_at=clock_timestamp(),
        updated_at=clock_timestamp(),
        version=a.version+1
    where a.id=v_applicant.id and a.tenant_id=v_applicant.tenant_id
    returning * into v_applicant;
  insert into public.provider_applicant_activity_events
    (tenant_id,applicant_id,event_type,actor_profile_id,client_action_id,note,metadata)
  values
    (v_applicant.tenant_id,v_applicant.id,'interview_stage_recorded',
     v_actor,p_client_action_id,v_note,
     jsonb_build_object('previousStatus',case when v_status='interview_invited' then 'screening'
         when v_status='accepted' and p_prior_version is not null then 'manual_interview_decision'
         else 'interview_scheduled' end,
        'status',v_status,'staffProfileCreated',false));
  return jsonb_build_object('id',v_applicant.id,'version',v_applicant.version,'idempotent',false);
end;
$fn$;

revoke all on function public.crm_record_applicant_interview_stage(uuid,text,bigint,uuid,text) from public,anon;
grant execute on function public.crm_record_applicant_interview_stage(uuid,text,bigint,uuid,text) to authenticated,service_role;

-- Reflect the new source statuses on connected applicant Kanban boards.
with p as (
  select id,tenant_id from public.crm_pipelines
  where source_mode='connected' and source_key='provider_applicants' and archived_at is null
), st(key,label,ord) as (
  values ('interview_invited','Interview Invited',1),
         ('interview_scheduled','Interview Scheduled',2),
         ('interview_completed','Interview Completed',3),
         ('accepted','Accepted',4)
)
insert into public.crm_pipeline_stages
  (tenant_id,pipeline_id,name,position,is_terminal,source_stage_key)
select p.tenant_id,p.id,st.label,
       coalesce((select max(x.position) from public.crm_pipeline_stages x
                 where x.pipeline_id=p.id),0)+st.ord,false,st.key
from p cross join st
where not exists (
  select 1 from public.crm_pipeline_stages x
  where x.pipeline_id=p.id and x.source_stage_key=st.key
);
