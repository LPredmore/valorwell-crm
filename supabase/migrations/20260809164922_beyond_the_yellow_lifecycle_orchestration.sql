-- Beyond The Yellow relationship lifecycle orchestration.
-- Additive, capture-first, and isolated from clinical scheduling/communications.

alter table public.relationship_campaigns
  add column if not exists lifecycle_policy text not null default 'generic_relationship_v1';

alter table public.relationship_campaigns
  drop constraint if exists relationship_campaigns_lifecycle_policy_check;
alter table public.relationship_campaigns
  add constraint relationship_campaigns_lifecycle_policy_check
  check (lifecycle_policy = any (array['generic_relationship_v1','bty_guest_outreach_v1']::text[]));

update public.relationship_campaigns
set lifecycle_policy = 'bty_guest_outreach_v1'
where tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
  and id = '50ec97e9-340d-4c1e-b2fd-2a3fc7fb649a'::uuid;

create table public.relationship_activity_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  activity_type text not null,
  source text not null,
  external_event_id text,
  organization_id uuid,
  contact_id uuid,
  opportunity_id uuid,
  campaign_id uuid,
  enrollment_id uuid,
  communication_id uuid,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  processing_status text not null default 'received',
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  applied_at timestamptz,
  error_code text,
  error_reason text,
  created_at timestamptz not null default now(),
  constraint relationship_activity_events_tenant_id_id_key unique (tenant_id,id),
  constraint relationship_activity_events_identity_key unique (tenant_id,idempotency_key),
  constraint relationship_activity_events_type_check check (activity_type = any (array[
    'opportunity_ready_for_campaign','campaign_auto_enrolled','outreach_sent',
    'human_reply_received','automated_reply_received','manual_outbound_email',
    'interest_confirmed','scheduling_started','recording_booked',
    'recording_rescheduled','recording_cancelled','recording_completed',
    'declined','nurture_set','legacy_reconciliation'
  ]::text[])),
  constraint relationship_activity_events_source_check check (source = any (array[
    'crm','resend','gmail','google_calendar','relationship_worker','reconciliation'
  ]::text[])),
  constraint relationship_activity_events_status_check check (processing_status = any (array[
    'received','applied','ignored','ambiguous','failed'
  ]::text[])),
  constraint relationship_activity_events_metadata_check check (jsonb_typeof(metadata)='object'),
  constraint relationship_activity_events_tenant_organization_fkey foreign key (tenant_id,organization_id)
    references public.relationship_organizations(tenant_id,id),
  constraint relationship_activity_events_tenant_contact_fkey foreign key (tenant_id,contact_id)
    references public.relationship_contacts(tenant_id,id),
  constraint relationship_activity_events_tenant_opportunity_fkey foreign key (tenant_id,opportunity_id)
    references public.relationship_opportunities(tenant_id,id),
  constraint relationship_activity_events_tenant_campaign_fkey foreign key (tenant_id,campaign_id)
    references public.relationship_campaigns(tenant_id,id),
  constraint relationship_activity_events_tenant_enrollment_fkey foreign key (tenant_id,enrollment_id)
    references public.relationship_campaign_enrollments(tenant_id,id),
  constraint relationship_activity_events_tenant_communication_fkey foreign key (tenant_id,communication_id)
    references public.relationship_communications(tenant_id,id)
);

create unique index relationship_activity_events_external_uidx
  on public.relationship_activity_events(tenant_id,source,external_event_id)
  where external_event_id is not null;
create index relationship_activity_events_opportunity_idx
  on public.relationship_activity_events(tenant_id,opportunity_id,occurred_at desc);
create index relationship_activity_events_status_idx
  on public.relationship_activity_events(tenant_id,processing_status,received_at desc);

create table public.relationship_message_observations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  communication_id uuid not null,
  source text not null,
  provider_message_id text not null,
  provider_thread_id text,
  rfc_message_id text,
  observed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint relationship_message_observations_source_check check (source=any(array['resend','gmail']::text[])),
  constraint relationship_message_observations_metadata_check check (jsonb_typeof(metadata)='object'),
  constraint relationship_message_observations_tenant_communication_fkey foreign key (tenant_id,communication_id)
    references public.relationship_communications(tenant_id,id) on delete cascade,
  constraint relationship_message_observations_provider_key unique (tenant_id,source,provider_message_id)
);
create index relationship_message_observations_rfc_idx
  on public.relationship_message_observations(tenant_id,rfc_message_id)
  where rfc_message_id is not null;
create index relationship_message_observations_thread_idx
  on public.relationship_message_observations(tenant_id,source,provider_thread_id)
  where provider_thread_id is not null;

create table public.relationship_meetings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  opportunity_id uuid not null,
  organization_id uuid not null,
  contact_id uuid not null,
  purpose text not null default 'bty_recording',
  connection_id uuid not null,
  calendar_id text not null,
  external_event_id text not null,
  ical_uid text,
  starts_at timestamptz,
  ends_at timestamptz,
  event_status text not null,
  streamyard_url text not null,
  last_synced_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint relationship_meetings_purpose_check check (purpose='bty_recording'),
  constraint relationship_meetings_status_check check (event_status=any(array['confirmed','tentative','cancelled']::text[])),
  constraint relationship_meetings_streamyard_check check (streamyard_url='https://streamyard.com/frr4zf8e3s'),
  constraint relationship_meetings_external_key unique (tenant_id,calendar_id,external_event_id),
  constraint relationship_meetings_tenant_opportunity_fkey foreign key (tenant_id,opportunity_id)
    references public.relationship_opportunities(tenant_id,id),
  constraint relationship_meetings_tenant_organization_fkey foreign key (tenant_id,organization_id)
    references public.relationship_organizations(tenant_id,id),
  constraint relationship_meetings_tenant_contact_fkey foreign key (tenant_id,contact_id)
    references public.relationship_contacts(tenant_id,id)
);
create index relationship_meetings_opportunity_idx
  on public.relationship_meetings(tenant_id,opportunity_id,starts_at desc);

create table public.relationship_reconciliation_issues (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  issue_type text not null,
  severity text not null default 'warning',
  status text not null default 'open',
  opportunity_id uuid,
  activity_event_id uuid,
  source text not null,
  external_event_id text,
  summary text not null,
  details jsonb not null default '{}'::jsonb,
  resolution text,
  resolved_by_profile_id uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint relationship_reconciliation_issues_type_check check (issue_type=any(array[
    'auto_enrollment_failure','unmatched_likely_relationship_gmail','ambiguous_email_thread',
    'ambiguous_calendar_event','stale_integration_watch','sync_error','integrity_violation'
  ]::text[])),
  constraint relationship_reconciliation_issues_severity_check check (severity=any(array['info','warning','critical']::text[])),
  constraint relationship_reconciliation_issues_status_check check (status=any(array['open','resolved','ignored']::text[])),
  constraint relationship_reconciliation_issues_details_check check (jsonb_typeof(details)='object'),
  constraint relationship_reconciliation_issues_resolution_check check (
    (status='open' and resolved_at is null) or (status<>'open' and resolved_at is not null)
  ),
  constraint relationship_reconciliation_issues_tenant_opportunity_fkey foreign key (tenant_id,opportunity_id)
    references public.relationship_opportunities(tenant_id,id),
  constraint relationship_reconciliation_issues_tenant_activity_fkey foreign key (tenant_id,activity_event_id)
    references public.relationship_activity_events(tenant_id,id)
);
create index relationship_reconciliation_issues_queue_idx
  on public.relationship_reconciliation_issues(tenant_id,status,severity,created_at desc);
create unique index relationship_reconciliation_issues_external_open_uidx
  on public.relationship_reconciliation_issues(tenant_id,issue_type,source,external_event_id)
  where status='open' and external_event_id is not null;

create table private.relationship_feature_flags (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  flag_name text not null,
  enabled boolean not null default false,
  updated_by_profile_id uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id,flag_name),
  constraint relationship_feature_flags_name_check check (flag_name=any(array[
    'relationship_activity_capture_enabled','relationship_activity_mutation_enabled',
    'relationship_bty_auto_enrollment_enabled','relationship_gmail_observation_enabled',
    'relationship_calendar_observation_enabled','relationship_reconciliation_writes_enabled'
  ]::text[]))
);

insert into private.relationship_feature_flags(tenant_id,flag_name,enabled)
select '00000000-0000-0000-0000-000000000001'::uuid, flag_name,
  flag_name='relationship_activity_capture_enabled'
from unnest(array[
  'relationship_activity_capture_enabled','relationship_activity_mutation_enabled',
  'relationship_bty_auto_enrollment_enabled','relationship_gmail_observation_enabled',
  'relationship_calendar_observation_enabled','relationship_reconciliation_writes_enabled'
]::text[]) flag_name
on conflict (tenant_id,flag_name) do nothing;

create table private.relationship_google_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  connection_type text not null,
  google_account_email text not null,
  google_account_id text,
  calendar_id text,
  scopes text[] not null,
  refresh_token_secret_id uuid not null,
  connected_by_profile_id uuid references public.profiles(id) on delete set null,
  status text not null default 'active',
  last_verified_at timestamptz,
  last_error_code text,
  last_error_reason text,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint relationship_google_connections_type_check check (connection_type=any(array['gmail','calendar']::text[])),
  constraint relationship_google_connections_status_check check (status=any(array['active','error','revoked']::text[])),
  constraint relationship_google_connections_mailbox_check check (
    connection_type<>'gmail' or lower(google_account_email)='info@valorwell.org'
  ),
  constraint relationship_google_connections_calendar_check check (
    (connection_type='calendar' and calendar_id is not null) or
    (connection_type='gmail' and calendar_id is null)
  )
);
create unique index relationship_google_connections_gmail_uidx
  on private.relationship_google_connections(tenant_id,connection_type)
  where connection_type='gmail' and status<>'revoked';
create unique index relationship_google_connections_calendar_uidx
  on private.relationship_google_connections(tenant_id,connection_type,calendar_id)
  where connection_type='calendar' and status<>'revoked';

create table private.relationship_google_oauth_states (
  state_hash text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  connection_type text not null check (connection_type=any(array['gmail','calendar']::text[])),
  actor_profile_id uuid not null references public.profiles(id) on delete cascade,
  code_verifier text not null,
  redirect_uri text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table private.relationship_google_sync_state (
  connection_id uuid primary key references private.relationship_google_connections(id) on delete cascade,
  gmail_history_id text,
  gmail_watch_expiration timestamptz,
  calendar_sync_token text,
  last_notification_at timestamptz,
  last_successful_sync_at timestamptz,
  last_full_reconciliation_at timestamptz,
  sync_locked_until timestamptz,
  last_error_code text,
  last_error_reason text,
  updated_at timestamptz not null default now()
);

create table private.relationship_calendar_channels (
  connection_id uuid primary key references private.relationship_google_connections(id) on delete cascade,
  channel_id uuid not null unique,
  channel_token text not null,
  resource_id text not null,
  expiration timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.relationship_bty_auto_enrollment_idempotency (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  opportunity_id uuid not null,
  campaign_id uuid not null,
  policy_version text not null,
  enrollment_id uuid,
  created_at timestamptz not null default now(),
  primary key (tenant_id,opportunity_id,campaign_id,policy_version),
  constraint relationship_bty_auto_enrollment_opportunity_fkey foreign key (tenant_id,opportunity_id)
    references public.relationship_opportunities(tenant_id,id),
  constraint relationship_bty_auto_enrollment_campaign_fkey foreign key (tenant_id,campaign_id)
    references public.relationship_campaigns(tenant_id,id),
  constraint relationship_bty_auto_enrollment_enrollment_fkey foreign key (tenant_id,enrollment_id)
    references public.relationship_campaign_enrollments(tenant_id,id)
);

alter table public.relationship_activity_events enable row level security;
alter table public.relationship_message_observations enable row level security;
alter table public.relationship_meetings enable row level security;
alter table public.relationship_reconciliation_issues enable row level security;
alter table private.relationship_feature_flags enable row level security;
alter table private.relationship_google_connections enable row level security;
alter table private.relationship_google_oauth_states enable row level security;
alter table private.relationship_google_sync_state enable row level security;
alter table private.relationship_calendar_channels enable row level security;
alter table private.relationship_bty_auto_enrollment_idempotency enable row level security;

create policy relationship_activity_events_crm_select on public.relationship_activity_events
for select to authenticated using (exists (
  select 1 from public.crm_user_capabilities c
  where c.profile_id=(select auth.uid()) and c.tenant_id=relationship_activity_events.tenant_id
    and c.crm_role<>'crm_none'::public.crm_capability_role
));
create policy relationship_message_observations_crm_select on public.relationship_message_observations
for select to authenticated using (exists (
  select 1 from public.crm_user_capabilities c
  where c.profile_id=(select auth.uid()) and c.tenant_id=relationship_message_observations.tenant_id
    and c.crm_role<>'crm_none'::public.crm_capability_role
));
create policy relationship_meetings_crm_select on public.relationship_meetings
for select to authenticated using (exists (
  select 1 from public.crm_user_capabilities c
  where c.profile_id=(select auth.uid()) and c.tenant_id=relationship_meetings.tenant_id
    and c.crm_role<>'crm_none'::public.crm_capability_role
));
create policy relationship_reconciliation_issues_crm_select on public.relationship_reconciliation_issues
for select to authenticated using (exists (
  select 1 from public.crm_user_capabilities c
  where c.profile_id=(select auth.uid()) and c.tenant_id=relationship_reconciliation_issues.tenant_id
    and c.crm_role<>'crm_none'::public.crm_capability_role
));

revoke all on public.relationship_activity_events,public.relationship_message_observations,
  public.relationship_meetings,public.relationship_reconciliation_issues from public,anon,authenticated;
grant select on public.relationship_activity_events,public.relationship_message_observations,
  public.relationship_meetings,public.relationship_reconciliation_issues to authenticated;
grant all on public.relationship_activity_events,public.relationship_message_observations,
  public.relationship_meetings,public.relationship_reconciliation_issues to service_role;
revoke all on private.relationship_feature_flags,private.relationship_google_connections,
  private.relationship_google_oauth_states,private.relationship_google_sync_state,
  private.relationship_calendar_channels,private.relationship_bty_auto_enrollment_idempotency
  from public,anon,authenticated;
grant all on private.relationship_feature_flags,private.relationship_google_connections,
  private.relationship_google_oauth_states,private.relationship_google_sync_state,
  private.relationship_calendar_channels,private.relationship_bty_auto_enrollment_idempotency
  to service_role;

comment on table public.relationship_activity_events is
  'Append-only normalized relationship evidence. Integrations submit evidence; the activity engine owns lifecycle effects.';
comment on table public.relationship_message_observations is
  'Provider observations that deduplicate Gmail and Resend views of one canonical relationship communication.';
comment on table public.relationship_meetings is
  'Relationship-only Google Calendar projection for linked BTY recording events; never clinical scheduling.';
comment on table private.relationship_google_connections is
  'Relationship-only Google connections. Refresh tokens are referenced from Supabase Vault and never exposed through the Data API.';

create or replace function private.relationship_flag_enabled(p_tenant_id uuid,p_flag_name text)
returns boolean language sql stable security definer set search_path to '' as $function$
  select coalesce((select enabled from private.relationship_feature_flags
    where tenant_id=p_tenant_id and flag_name=p_flag_name),false);
$function$;

create or replace function private.relationship_header_value(p_headers jsonb,p_name text)
returns text language sql immutable set search_path to '' as $function$
  select nullif(btrim(coalesce(
    case when jsonb_typeof(p_headers)='object' then
      (select value from jsonb_each_text(p_headers) where lower(key)=lower(p_name) limit 1)
    end,
    case when jsonb_typeof(p_headers)='array' then
      (select item->>'value' from jsonb_array_elements(p_headers) item
       where lower(item->>'name')=lower(p_name) limit 1)
    end
  )), '');
$function$;

create or replace function private.classify_relationship_email(
  p_headers jsonb,p_subject text,p_from_email text
)
returns text language plpgsql immutable set search_path to '' as $function$
declare
  v_auto text:=lower(coalesce(private.relationship_header_value(p_headers,'auto-submitted'),''));
  v_precedence text:=lower(coalesce(private.relationship_header_value(p_headers,'precedence'),''));
  v_subject text:=lower(coalesce(p_subject,''));
  v_from text:=lower(coalesce(p_from_email,''));
begin
  if (v_auto<>'' and v_auto<>'no')
     or v_precedence=any(array['bulk','junk','list','auto_reply']::text[])
     or private.relationship_header_value(p_headers,'x-autoreply') is not null
     or private.relationship_header_value(p_headers,'x-autorespond') is not null
     or private.relationship_header_value(p_headers,'x-auto-response-suppress') is not null
     or v_from ~ '(^|[<[:space:]])(mailer-daemon|postmaster)@'
     or v_subject ~ '(automatic reply|auto.?reply|out of office|delivery status notification|undeliverable|mail delivery failed)'
  then return 'automated'; end if;
  return 'human';
end;
$function$;

create or replace function private.open_relationship_reconciliation_issue(
  p_tenant_id uuid,p_issue_type text,p_source text,p_summary text,
  p_external_event_id text default null,p_opportunity_id uuid default null,
  p_activity_event_id uuid default null,p_details jsonb default '{}'::jsonb,
  p_severity text default 'warning'
)
returns uuid language plpgsql security definer set search_path to '' as $function$
declare v_id uuid;
begin
  insert into public.relationship_reconciliation_issues(
    tenant_id,issue_type,severity,opportunity_id,activity_event_id,source,
    external_event_id,summary,details
  ) values (
    p_tenant_id,p_issue_type,p_severity,p_opportunity_id,p_activity_event_id,p_source,
    nullif(btrim(p_external_event_id),''),p_summary,coalesce(p_details,'{}'::jsonb)
  )
  on conflict (tenant_id,issue_type,source,external_event_id)
    where status='open' and external_event_id is not null
  do update set summary=excluded.summary,details=excluded.details,updated_at=now()
  returning id into v_id;
  return v_id;
end;
$function$;

create or replace function private.transition_relationship_opportunity_from_activity(
  p_opportunity_id uuid,p_to_status text,p_activity_id uuid,p_reason text,p_changed_at timestamptz,
  p_actor_id uuid default null
)
returns public.relationship_opportunities language plpgsql security definer set search_path to '' as $function$
declare
  v_opportunity public.relationship_opportunities%rowtype;
  v_from text;
begin
  select * into v_opportunity from public.relationship_opportunities
  where id=p_opportunity_id for update;
  if not found then raise exception 'Relationship opportunity not found.' using errcode='P0002'; end if;
  if v_opportunity.status=p_to_status then return v_opportunity; end if;
  v_from:=v_opportunity.status;
  update public.relationship_opportunities
  set status=p_to_status,updated_by_profile_id=p_actor_id
  where id=v_opportunity.id returning * into v_opportunity;
  update public.relationship_opportunities
  set status_changed_at=coalesce(p_changed_at,now()),
      closed_at=case when status=any(array['declined','disqualified','completed']::text[])
                     then coalesce(p_changed_at,now()) else null end
  where id=v_opportunity.id returning * into v_opportunity;
  insert into public.relationship_opportunity_status_history(
    tenant_id,opportunity_id,from_status,to_status,changed_at,reason,version,metadata,
    created_by_profile_id,updated_by_profile_id
  ) values (
    v_opportunity.tenant_id,v_opportunity.id,v_from,p_to_status,coalesce(p_changed_at,now()),
    nullif(btrim(p_reason),''),v_opportunity.version,
    jsonb_build_object('relationship_activity_event_id',p_activity_id,'application_engine','bty_v1'),
    p_actor_id,p_actor_id
  );
  insert into public.relationship_interactions(
    tenant_id,organization_id,contact_id,opportunity_id,interaction_type,occurred_at,
    summary,metadata,created_by_profile_id,updated_by_profile_id
  ) values (
    v_opportunity.tenant_id,v_opportunity.organization_id,v_opportunity.primary_contact_id,
    v_opportunity.id,'opportunity_status_change',coalesce(p_changed_at,now()),
    format('BTY opportunity status changed from %s to %s from verified relationship evidence.',v_from,p_to_status),
    jsonb_build_object('from_status',v_from,'to_status',p_to_status,
      'relationship_activity_event_id',p_activity_id,'reason',nullif(btrim(p_reason),'')),
    p_actor_id,p_actor_id
  );
  return v_opportunity;
end;
$function$;

-- Retain the existing generic resolver, then add campaign-specific admission policy.
do $migration$
begin
  if to_regprocedure('private.evaluate_relationship_campaign_target_pre_bty(uuid,uuid,jsonb)') is null then
    alter function private.evaluate_relationship_campaign_target(uuid,uuid,jsonb)
      rename to evaluate_relationship_campaign_target_pre_bty;
  end if;
end
$migration$;

create or replace function private.evaluate_relationship_campaign_target(
  p_tenant_id uuid,p_campaign_id uuid,p_target jsonb
)
returns jsonb language plpgsql stable security definer set search_path to '' as $function$
declare
  v_result jsonb;
  v_policy text;
  v_opportunity_id uuid:=nullif(p_target->>'opportunityId','')::uuid;
  v_opportunity public.relationship_opportunities%rowtype;
  v_reasons text[]:='{}'::text[];
begin
  v_result:=private.evaluate_relationship_campaign_target_pre_bty(p_tenant_id,p_campaign_id,p_target);
  select lifecycle_policy into v_policy from public.relationship_campaigns
  where tenant_id=p_tenant_id and id=p_campaign_id;
  select coalesce(array_agg(value),'{}'::text[]) into v_reasons
  from jsonb_array_elements_text(coalesce(v_result->'reasons','[]'::jsonb));
  if v_policy='bty_guest_outreach_v1' then
    if v_opportunity_id is null then
      v_reasons:=array_append(v_reasons,'opportunity_required');
    else
      select * into v_opportunity from public.relationship_opportunities
      where tenant_id=p_tenant_id and id=v_opportunity_id;
      if found and v_opportunity.status<>all(array['qualified','ready_for_campaign']::text[]) then
        v_reasons:=array_append(v_reasons,'bty_admission_status_blocked');
      end if;
      if exists(select 1 from public.relationship_activity_events a
        where a.tenant_id=p_tenant_id and a.opportunity_id=v_opportunity_id
          and a.activity_type='human_reply_received') then
        v_reasons:=array_append(v_reasons,'previous_response');
      end if;
    end if;
  end if;
  v_reasons:=array(select distinct x from unnest(v_reasons) x order by x);
  return v_result||jsonb_build_object(
    'eligible',cardinality(v_reasons)=0,'reasons',to_jsonb(v_reasons),
    'lifecyclePolicy',coalesce(v_policy,'generic_relationship_v1'),
    'policyVersion',case when v_policy='bty_guest_outreach_v1' then 'bty_guest_outreach_v1' else 'generic_relationship_v1' end
  );
end;
$function$;

-- Separate admission from continuation: Contacted remains eligible for a queued BTY step,
-- while response/scheduling/terminal states block every future automated step.
do $migration$
begin
  if to_regprocedure('private.evaluate_relationship_safety_values_pre_bty(uuid,uuid,uuid,uuid,uuid,text,text,jsonb)') is null then
    alter function private.evaluate_relationship_safety_values(uuid,uuid,uuid,uuid,uuid,text,text,jsonb)
      rename to evaluate_relationship_safety_values_pre_bty;
  end if;
end
$migration$;

create or replace function private.evaluate_relationship_safety_values(
  p_tenant_id uuid,p_campaign_id uuid,p_contact_id uuid,p_organization_id uuid,
  p_opportunity_id uuid,p_recipient_email text,p_source_language_mode text,p_eligibility_snapshot jsonb
)
returns jsonb language plpgsql stable security definer set search_path to '' as $function$
declare
  v_result jsonb;
  v_policy text;
  v_status text;
  v_reasons text[]:='{}'::text[];
begin
  v_result:=private.evaluate_relationship_safety_values_pre_bty(
    p_tenant_id,p_campaign_id,p_contact_id,p_organization_id,p_opportunity_id,
    p_recipient_email,p_source_language_mode,p_eligibility_snapshot
  );
  select lifecycle_policy into v_policy from public.relationship_campaigns
  where tenant_id=p_tenant_id and id=p_campaign_id;
  if v_policy<>'bty_guest_outreach_v1' or p_opportunity_id is null then return v_result; end if;
  select status into v_status from public.relationship_opportunities
  where tenant_id=p_tenant_id and id=p_opportunity_id;
  select coalesce(array_agg(value),'{}'::text[]) into v_reasons
  from jsonb_array_elements_text(coalesce(v_result->'reasons','[]'::jsonb));
  if v_status='contacted' then
    v_reasons:=array(select x from unnest(v_reasons) x where x<>'opportunity_not_qualified');
  elsif v_status=any(array['responded','interested','recording_planned','booked','completed','declined','nurture','disqualified']::text[]) then
    v_reasons:=array_append(v_reasons,'bty_lifecycle_blocks_send');
  end if;
  v_reasons:=array(select distinct x from unnest(v_reasons) x order by x);
  return v_result||jsonb_build_object(
    'eligible',cardinality(v_reasons)=0,
    'safetyEligible',cardinality(v_reasons)=0,
    'safetyStatus',case when cardinality(v_reasons)=0 then 'ready' else 'blocked' end,
    'reasons',to_jsonb(v_reasons),'policyVersion','bty_guest_outreach_v1'
  );
end;
$function$;

create or replace function private.auto_enroll_bty_opportunity(p_opportunity_id uuid,p_activity_id uuid)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare
  v_campaign_id constant uuid:='50ec97e9-340d-4c1e-b2fd-2a3fc7fb649a'::uuid;
  v_opportunity public.relationship_opportunities%rowtype;
  v_campaign public.relationship_campaigns%rowtype;
  v_step public.relationship_campaign_steps%rowtype;
  v_evaluation jsonb;
  v_enrollment_id uuid;
  v_due_at timestamptz;
begin
  select * into v_opportunity from public.relationship_opportunities
  where id=p_opportunity_id for update;
  if not found then raise exception 'BTY opportunity not found.' using errcode='P0002'; end if;
  if v_opportunity.status<>'ready_for_campaign' or v_opportunity.review_status<>'approved' then
    raise exception 'BTY opportunity is not approved and ready for campaign.' using errcode='22023';
  end if;
  select * into v_campaign from public.relationship_campaigns
  where tenant_id=v_opportunity.tenant_id and id=v_campaign_id;
  if not found or v_campaign.lifecycle_policy<>'bty_guest_outreach_v1'
     or v_campaign.status<>'active' or not v_campaign.execution_enabled then
    raise exception 'Canonical BTY campaign is not active and execution-enabled.' using errcode='42501';
  end if;
  select enrollment_id into v_enrollment_id
  from private.relationship_bty_auto_enrollment_idempotency
  where tenant_id=v_opportunity.tenant_id and opportunity_id=v_opportunity.id
    and campaign_id=v_campaign_id and policy_version='bty_guest_outreach_v1';
  if found then
    return jsonb_build_object('replayed',true,'enrollmentId',v_enrollment_id);
  end if;
  v_evaluation:=private.evaluate_relationship_campaign_target(
    v_opportunity.tenant_id,v_campaign_id,
    jsonb_build_object('opportunityId',v_opportunity.id,'sourceLanguageMode','none')
  );
  if coalesce((v_evaluation->>'eligible')::boolean,false) is not true then
    raise exception 'BTY auto-enrollment is not eligible: %',(v_evaluation->'reasons')::text using errcode='22023';
  end if;
  select * into v_step from public.relationship_campaign_steps
  where tenant_id=v_opportunity.tenant_id and campaign_id=v_campaign_id and is_active
  order by position limit 1;
  if not found then raise exception 'Canonical BTY campaign has no active initial step.' using errcode='22023'; end if;
  v_due_at:=private.relationship_campaign_schedule_at(
    now(),v_campaign.default_timezone,v_campaign.weekdays_only,
    v_campaign.send_window_start,v_campaign.send_window_end,v_step.delay_days
  );
  perform set_config('app.relationship_delivery_activation','allowed',true);
  insert into public.relationship_campaign_enrollments(
    tenant_id,campaign_id,contact_id,organization_id,opportunity_id,recipient_email,recipient_name,
    status,current_step_position,next_scheduled_at,source_language_mode,personalization_context,
    eligibility_snapshot,safety_status,delivery_enabled,metadata
  ) values (
    v_opportunity.tenant_id,v_campaign_id,(v_evaluation->>'resolvedContactId')::uuid,
    v_opportunity.organization_id,v_opportunity.id,v_evaluation->>'recipientEmail',v_evaluation->>'recipientName',
    'pending',v_step.position,v_due_at,v_evaluation->>'sourceLanguageMode',
    coalesce(v_evaluation->'personalizationContext','{}'::jsonb),v_evaluation,
    'pending_pass_11',true,jsonb_build_object('auto_enrollment',true,'relationship_activity_event_id',p_activity_id)
  ) returning id into v_enrollment_id;
  insert into private.relationship_bty_auto_enrollment_idempotency(
    tenant_id,opportunity_id,campaign_id,policy_version,enrollment_id
  ) values (v_opportunity.tenant_id,v_opportunity.id,v_campaign_id,'bty_guest_outreach_v1',v_enrollment_id);
  insert into private.relationship_campaign_work_items(
    tenant_id,campaign_id,enrollment_id,campaign_step_id,step_position,status,due_at,available_at,idempotency_key,metadata
  ) values (
    v_opportunity.tenant_id,v_campaign_id,v_enrollment_id,v_step.id,v_step.position,'planned',v_due_at,v_due_at,
    format('enrollment:%s:step:%s',v_enrollment_id,v_step.id),jsonb_build_object('auto_enrollment',true)
  );
  insert into public.relationship_enrollment_events(
    tenant_id,enrollment_id,event_type,to_status,reason,metadata
  ) values (
    v_opportunity.tenant_id,v_enrollment_id,'enrolled','pending',
    'Approved BTY opportunity automatically enrolled through bty_guest_outreach_v1.',
    jsonb_build_object('relationship_activity_event_id',p_activity_id,'delivery_enabled',true)
  );
  insert into public.relationship_interactions(
    tenant_id,organization_id,contact_id,opportunity_id,interaction_type,occurred_at,summary,metadata
  ) values (
    v_opportunity.tenant_id,v_opportunity.organization_id,v_opportunity.primary_contact_id,
    v_opportunity.id,'campaign_enrollment',now(),'Approved BTY opportunity automatically enrolled in the canonical outreach campaign.',
    jsonb_build_object('campaign_id',v_campaign_id,'enrollment_id',v_enrollment_id,'relationship_activity_event_id',p_activity_id)
  );
  insert into public.relationship_activity_events(
    tenant_id,activity_type,source,organization_id,contact_id,opportunity_id,campaign_id,enrollment_id,
    occurred_at,processing_status,idempotency_key,metadata,applied_at
  ) values (
    v_opportunity.tenant_id,'campaign_auto_enrolled','relationship_worker',v_opportunity.organization_id,
    v_opportunity.primary_contact_id,v_opportunity.id,v_campaign_id,v_enrollment_id,now(),'applied',
    format('bty-auto-enroll:%s:%s:v1',v_opportunity.id,v_campaign_id),
    jsonb_build_object('trigger_activity_event_id',p_activity_id),now()
  ) on conflict (tenant_id,idempotency_key) do nothing;
  return jsonb_build_object('replayed',false,'enrollmentId',v_enrollment_id,'dueAt',v_due_at);
end;
$function$;

create or replace function private.apply_relationship_activity(
  p_tenant_id uuid,p_activity_type text,p_source text,p_idempotency_key text,
  p_external_event_id text default null,p_organization_id uuid default null,
  p_contact_id uuid default null,p_opportunity_id uuid default null,
  p_campaign_id uuid default null,p_enrollment_id uuid default null,
  p_communication_id uuid default null,p_occurred_at timestamptz default now(),
  p_metadata jsonb default '{}'::jsonb,p_actor_id uuid default null
)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare
  v_activity public.relationship_activity_events%rowtype;
  v_opportunity public.relationship_opportunities%rowtype;
  v_target_status text;
  v_reason text;
  v_mutation boolean;
  v_auto jsonb;
begin
  if nullif(btrim(p_idempotency_key),'') is null then
    raise exception 'Relationship activity idempotency key is required.' using errcode='22023';
  end if;
  if not private.relationship_flag_enabled(p_tenant_id,'relationship_activity_capture_enabled') then
    return jsonb_build_object('captured',false,'reason','relationship_activity_capture_disabled');
  end if;
  insert into public.relationship_activity_events(
    tenant_id,activity_type,source,external_event_id,organization_id,contact_id,opportunity_id,
    campaign_id,enrollment_id,communication_id,occurred_at,processing_status,idempotency_key,metadata
  ) values (
    p_tenant_id,p_activity_type,p_source,nullif(btrim(p_external_event_id),''),p_organization_id,p_contact_id,
    p_opportunity_id,p_campaign_id,p_enrollment_id,p_communication_id,coalesce(p_occurred_at,now()),
    'received',btrim(p_idempotency_key),coalesce(p_metadata,'{}'::jsonb)
  ) on conflict (tenant_id,idempotency_key) do nothing
  returning * into v_activity;
  if not found then
    select * into v_activity from public.relationship_activity_events
    where tenant_id=p_tenant_id and idempotency_key=btrim(p_idempotency_key) for update;
    return jsonb_build_object('captured',true,'replayed',true,'activityId',v_activity.id,
      'processingStatus',v_activity.processing_status,'opportunityId',v_activity.opportunity_id);
  end if;

  if p_opportunity_id is null then
    update public.relationship_activity_events set processing_status='ambiguous',
      error_code='opportunity_unresolved',error_reason='No unique relationship opportunity was resolved.'
    where id=v_activity.id returning * into v_activity;
    perform private.open_relationship_reconciliation_issue(
      p_tenant_id,case when p_source='google_calendar' then 'ambiguous_calendar_event' else 'ambiguous_email_thread' end,
      p_source,'Relationship evidence could not be tied to exactly one opportunity.',p_external_event_id,
      null,v_activity.id,coalesce(p_metadata,'{}'::jsonb)
    );
    return jsonb_build_object('captured',true,'activityId',v_activity.id,'processingStatus','ambiguous');
  end if;

  -- Lock order: activity identity (above), opportunity, enrollment, work items, communication/reply.
  select * into v_opportunity from public.relationship_opportunities
  where tenant_id=p_tenant_id and id=p_opportunity_id for update;
  if not found then
    update public.relationship_activity_events set processing_status='failed',
      error_code='opportunity_not_found',error_reason='Resolved relationship opportunity no longer exists.'
    where id=v_activity.id;
    return jsonb_build_object('captured',true,'activityId',v_activity.id,'processingStatus','failed');
  end if;
  if p_enrollment_id is not null then
    perform 1 from public.relationship_campaign_enrollments
    where tenant_id=p_tenant_id and id=p_enrollment_id for update;
    perform 1 from private.relationship_campaign_work_items
    where tenant_id=p_tenant_id and enrollment_id=p_enrollment_id
    order by id for update;
  end if;
  if p_communication_id is not null then
    perform 1 from public.relationship_communications
    where tenant_id=p_tenant_id and id=p_communication_id for update;
    perform 1 from public.relationship_replies
    where tenant_id=p_tenant_id and communication_id=p_communication_id for update;
  end if;

  v_target_status:=case p_activity_type
    when 'outreach_sent' then case
      when v_opportunity.status=any(array['identified','researching','qualified','ready_for_campaign']::text[]) then 'contacted' end
    when 'human_reply_received' then case
      when v_opportunity.status=any(array['identified','researching','qualified','ready_for_campaign','contacted']::text[]) then 'responded' end
    when 'interest_confirmed' then case
      when v_opportunity.status=any(array['identified','researching','qualified','ready_for_campaign','contacted','responded']::text[]) then 'interested' end
    when 'scheduling_started' then case
      when v_opportunity.status=any(array['identified','researching','qualified','ready_for_campaign','contacted','responded','interested']::text[]) then 'recording_planned' end
    when 'recording_booked' then case when v_opportunity.status<>all(array['completed','declined','disqualified']::text[]) then 'booked' end
    when 'recording_rescheduled' then case when v_opportunity.status<>all(array['completed','declined','disqualified']::text[]) then 'booked' end
    when 'recording_cancelled' then case when v_opportunity.status='booked' then 'recording_planned' end
    when 'recording_completed' then case when v_opportunity.status='booked' then 'completed' end
    when 'declined' then case when v_opportunity.status<>'completed' then 'declined' end
    when 'nurture_set' then case when v_opportunity.status<>'completed' then 'nurture' end
    else null end;
  v_reason:=format('%s evidence applied from %s.',replace(p_activity_type,'_',' '),p_source);
  v_mutation:=private.relationship_flag_enabled(p_tenant_id,'relationship_activity_mutation_enabled')
    or (p_activity_type='legacy_reconciliation'
      and private.relationship_flag_enabled(p_tenant_id,'relationship_reconciliation_writes_enabled'));
  if p_activity_type='legacy_reconciliation' then
    if p_source<>'reconciliation' then
      update public.relationship_activity_events set processing_status='failed',
        error_code='invalid_reconciliation_source',error_reason='Legacy reconciliation must use the reconciliation source.'
      where id=v_activity.id;
      return jsonb_build_object('captured',true,'activityId',v_activity.id,'processingStatus','failed');
    end if;
    v_target_status:=case p_metadata->>'evidence_type'
      when 'successful_outbound' then case when p_metadata->>'target_status'='contacted' then 'contacted' end
      when 'verified_human_reply' then case when p_metadata->>'target_status'='responded' then 'responded' end
      when 'linked_recording' then case when p_metadata->>'target_status'='booked' then 'booked' end
      when 'explicit_completion' then case when p_metadata->>'target_status'='completed' then 'completed' end
      else null end;
    if v_target_status is null then
      update public.relationship_activity_events set processing_status='failed',
        error_code='invalid_reconciliation_evidence',error_reason='Reconciliation target is not supported by its evidence type.'
      where id=v_activity.id;
      return jsonb_build_object('captured',true,'activityId',v_activity.id,'processingStatus','failed');
    end if;
  end if;

  if p_activity_type='automated_reply_received' then
    update public.relationship_activity_events set processing_status='ignored',applied_at=now(),
      error_code='automated_reply_no_lifecycle_effect',error_reason='Deterministic headers identify an automated response.'
    where id=v_activity.id;
    return jsonb_build_object('captured',true,'activityId',v_activity.id,'processingStatus','ignored');
  end if;

  if not v_mutation then
    update public.relationship_activity_events set processing_status='ignored',applied_at=now(),
      error_code='shadow_mode',error_reason='Activity captured; lifecycle mutation is disabled.',
      metadata=metadata||jsonb_strip_nulls(jsonb_build_object(
        'shadow_current_status',v_opportunity.status,'shadow_target_status',v_target_status
      ))
    where id=v_activity.id;
    return jsonb_build_object('captured',true,'activityId',v_activity.id,
      'processingStatus','ignored','shadow',true,'currentStatus',v_opportunity.status,'targetStatus',v_target_status);
  end if;

  if v_target_status is not null and v_target_status<>v_opportunity.status then
    perform private.transition_relationship_opportunity_from_activity(
      v_opportunity.id,v_target_status,v_activity.id,v_reason,v_activity.occurred_at,p_actor_id
    );
  end if;

  if p_activity_type='human_reply_received' and p_enrollment_id is not null then
    update public.relationship_campaign_enrollments
    set status=case when status=any(array['pending','active','paused']::text[]) then 'responded' else status end,
        responded_at=coalesce(responded_at,v_activity.occurred_at),delivery_enabled=false,next_scheduled_at=null,
        updated_by_profile_id=p_actor_id
    where tenant_id=p_tenant_id and id=p_enrollment_id;
    update private.relationship_campaign_work_items
    set status='cancelled',claim_token=null,claimed_by=null,claimed_at=null,lease_expires_at=null,
        updated_at=now(),metadata=metadata||jsonb_build_object('cancelled_by_activity_event_id',v_activity.id)
    where tenant_id=p_tenant_id and enrollment_id=p_enrollment_id
      and status=any(array['planned','retry_wait','claimed']::text[]);
  elsif v_target_status=any(array['responded','interested','recording_planned','booked','completed','declined','nurture','disqualified']::text[]) then
    update public.relationship_campaign_enrollments
    set delivery_enabled=false,next_scheduled_at=null,
        status=case when status=any(array['pending','active','paused']::text[]) then 'stopped' else status end,
        stopped_reason=coalesce(stopped_reason,'Stopped by BTY lifecycle policy.'),updated_by_profile_id=p_actor_id
    where tenant_id=p_tenant_id and opportunity_id=p_opportunity_id
      and campaign_id='50ec97e9-340d-4c1e-b2fd-2a3fc7fb649a'::uuid
      and status=any(array['pending','active','paused']::text[]);
    update private.relationship_campaign_work_items w
    set status='cancelled',claim_token=null,claimed_by=null,claimed_at=null,lease_expires_at=null,
        updated_at=now(),metadata=metadata||jsonb_build_object('cancelled_by_activity_event_id',v_activity.id)
    from public.relationship_campaign_enrollments e
    where e.tenant_id=p_tenant_id and e.opportunity_id=p_opportunity_id
      and e.campaign_id='50ec97e9-340d-4c1e-b2fd-2a3fc7fb649a'::uuid
      and w.tenant_id=e.tenant_id and w.enrollment_id=e.id
      and w.status=any(array['planned','retry_wait','claimed']::text[]);
  end if;

  if p_activity_type='opportunity_ready_for_campaign'
     and private.relationship_flag_enabled(p_tenant_id,'relationship_bty_auto_enrollment_enabled') then
    begin
      v_auto:=private.auto_enroll_bty_opportunity(p_opportunity_id,v_activity.id);
    exception when others then
      perform private.open_relationship_reconciliation_issue(
        p_tenant_id,'auto_enrollment_failure',p_source,
        'Approved BTY opportunity could not be automatically enrolled.',
        p_opportunity_id::text,p_opportunity_id,v_activity.id,
        jsonb_build_object('sqlstate',sqlstate,'reason',sqlerrm),'warning'
      );
      update public.relationship_activity_events set processing_status='failed',applied_at=now(),
        error_code='auto_enrollment_failed',error_reason=sqlerrm where id=v_activity.id;
      return jsonb_build_object('captured',true,'activityId',v_activity.id,
        'processingStatus','failed','errorCode','auto_enrollment_failed');
    end;
  end if;

  update public.relationship_activity_events set processing_status='applied',applied_at=now(),
    metadata=metadata||jsonb_strip_nulls(jsonb_build_object(
      'prior_status',v_opportunity.status,'resulting_status',v_target_status,'auto_enrollment',v_auto
    ))
  where id=v_activity.id;
  return jsonb_strip_nulls(jsonb_build_object('captured',true,'activityId',v_activity.id,
    'processingStatus','applied','opportunityId',p_opportunity_id,'targetStatus',v_target_status,
    'autoEnrollment',v_auto));
end;
$function$;

create or replace function public.apply_relationship_activity(
  p_tenant_id uuid,p_activity_type text,p_source text,p_idempotency_key text,
  p_external_event_id text default null,p_organization_id uuid default null,
  p_contact_id uuid default null,p_opportunity_id uuid default null,p_campaign_id uuid default null,
  p_enrollment_id uuid default null,p_communication_id uuid default null,
  p_occurred_at timestamptz default now(),p_metadata jsonb default '{}'::jsonb
)
returns jsonb language sql security definer set search_path to '' as $function$
  select private.apply_relationship_activity(
    p_tenant_id,p_activity_type,p_source,p_idempotency_key,p_external_event_id,
    p_organization_id,p_contact_id,p_opportunity_id,p_campaign_id,p_enrollment_id,
    p_communication_id,p_occurred_at,p_metadata,null
  );
$function$;

create or replace function private.capture_bty_ready_for_campaign()
returns trigger language plpgsql security definer set search_path to '' as $function$
begin
  if new.status='ready_for_campaign' and new.review_status='approved'
     and (old.status is distinct from new.status or old.review_status is distinct from new.review_status) then
    perform private.apply_relationship_activity(
      new.tenant_id,'opportunity_ready_for_campaign','crm',
      format('bty-ready:%s:version:%s',new.id,new.version),null,
      new.organization_id,new.primary_contact_id,new.id,
      '50ec97e9-340d-4c1e-b2fd-2a3fc7fb649a'::uuid,null,null,now(),
      jsonb_build_object('review_status',new.review_status,'opportunity_version',new.version),auth.uid()
    );
  end if;
  return new;
end;
$function$;
drop trigger if exists capture_bty_ready_for_campaign on public.relationship_opportunities;
create trigger capture_bty_ready_for_campaign
after update of status,review_status on public.relationship_opportunities
for each row execute function private.capture_bty_ready_for_campaign();

create or replace function private.guard_bty_followup_activation()
returns trigger language plpgsql security definer set search_path to '' as $function$
begin
  if new.is_active and new.position>1 and exists(
    select 1 from public.relationship_campaigns c
    where c.tenant_id=new.tenant_id and c.id=new.campaign_id and c.lifecycle_policy='bty_guest_outreach_v1'
  ) then raise exception 'Automated BTY follow-up steps must remain inactive.' using errcode='42501'; end if;
  return new;
end;
$function$;
drop trigger if exists guard_bty_followup_activation on public.relationship_campaign_steps;
create trigger guard_bty_followup_activation
before insert or update of is_active,position,campaign_id on public.relationship_campaign_steps
for each row execute function private.guard_bty_followup_activation();

create or replace function private.relationship_orchestration_context(p_require_mutation boolean default false)
returns jsonb language sql stable security definer set search_path to '' as $function$
  select private.relationship_campaign_context(p_require_mutation);
$function$;

create or replace function public.record_relationship_operator_activity(
  p_opportunity_id uuid,p_activity_type text,p_idempotency_key text,p_metadata jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare
  v_context jsonb:=private.relationship_orchestration_context(true);
  v_actor uuid:=(v_context->>'actor_id')::uuid;
  v_tenant uuid:=(v_context->>'tenant_id')::uuid;
  v_opportunity public.relationship_opportunities%rowtype;
begin
  if p_activity_type<>all(array['interest_confirmed','scheduling_started','declined','nurture_set','recording_completed']::text[]) then
    raise exception 'Operator activity type is not allowed.' using errcode='22023';
  end if;
  select * into v_opportunity from public.relationship_opportunities
  where tenant_id=v_tenant and id=p_opportunity_id;
  if not found then raise exception 'Relationship opportunity not found.' using errcode='P0002'; end if;
  return private.apply_relationship_activity(
    v_tenant,p_activity_type,'crm',p_idempotency_key,null,
    v_opportunity.organization_id,v_opportunity.primary_contact_id,v_opportunity.id,
    null,null,null,now(),coalesce(p_metadata,'{}'::jsonb),v_actor
  );
end;
$function$;

create or replace function public.retry_relationship_bty_auto_enrollment(
  p_opportunity_id uuid,p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare
  v_context jsonb:=private.relationship_orchestration_context(true);
  v_actor uuid:=(v_context->>'actor_id')::uuid;
  v_tenant uuid:=(v_context->>'tenant_id')::uuid;
  v_opportunity public.relationship_opportunities%rowtype;
begin
  select * into v_opportunity from public.relationship_opportunities
  where tenant_id=v_tenant and id=p_opportunity_id;
  if not found then raise exception 'Relationship opportunity not found.' using errcode='P0002'; end if;
  return private.apply_relationship_activity(
    v_tenant,'opportunity_ready_for_campaign','crm',p_idempotency_key,null,
    v_opportunity.organization_id,v_opportunity.primary_contact_id,v_opportunity.id,
    '50ec97e9-340d-4c1e-b2fd-2a3fc7fb649a'::uuid,null,null,now(),
    jsonb_build_object('explicit_retry',true),v_actor
  );
end;
$function$;

create or replace function public.resolve_relationship_reconciliation_issue(
  p_issue_id uuid,p_status text,p_resolution text
)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare
  v_context jsonb:=private.relationship_orchestration_context(true);
  v_actor uuid:=(v_context->>'actor_id')::uuid;
  v_tenant uuid:=(v_context->>'tenant_id')::uuid;
  v_issue public.relationship_reconciliation_issues%rowtype;
begin
  if p_status<>all(array['resolved','ignored']::text[]) or nullif(btrim(p_resolution),'') is null then
    raise exception 'A resolved/ignored status and resolution are required.' using errcode='22023';
  end if;
  update public.relationship_reconciliation_issues set status=p_status,resolution=btrim(p_resolution),
    resolved_by_profile_id=v_actor,resolved_at=now(),updated_at=now()
  where tenant_id=v_tenant and id=p_issue_id and status='open' returning * into v_issue;
  if not found then raise exception 'Open relationship reconciliation issue not found.' using errcode='P0002'; end if;
  return jsonb_build_object('id',v_issue.id,'status',v_issue.status,'resolution',v_issue.resolution,
    'resolvedAt',v_issue.resolved_at);
end;
$function$;

create or replace function public.get_relationship_opportunity_orchestration(p_opportunity_id uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $function$
declare
  v_context jsonb:=private.relationship_orchestration_context(false);
  v_tenant uuid:=(v_context->>'tenant_id')::uuid;
begin
  if not exists(select 1 from public.relationship_opportunities
    where tenant_id=v_tenant and id=p_opportunity_id) then
    raise exception 'Relationship opportunity not found.' using errcode='P0002';
  end if;
  return jsonb_build_object(
    'activities',coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id',a.id,'activityType',a.activity_type,'source',a.source,'occurredAt',a.occurred_at,
      'processingStatus',a.processing_status,'errorCode',a.error_code,'errorReason',a.error_reason,
      'metadata',a.metadata
    )) order by a.occurred_at desc) from public.relationship_activity_events a
      where a.tenant_id=v_tenant and a.opportunity_id=p_opportunity_id),'[]'::jsonb),
    'enrollments',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'campaignId',e.campaign_id,'status',e.status,'deliveryEnabled',e.delivery_enabled,
      'currentStepPosition',e.current_step_position,'nextScheduledAt',e.next_scheduled_at,
      'stoppedReason',e.stopped_reason,'respondedAt',e.responded_at
    ) order by e.created_at desc) from public.relationship_campaign_enrollments e
      where e.tenant_id=v_tenant and e.opportunity_id=p_opportunity_id),'[]'::jsonb),
    'communications',coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id',c.id,'direction',c.direction,'status',c.status,'provider',c.provider,'subject',c.subject,
      'occurredAt',c.occurred_at,'enrollmentId',c.enrollment_id
    )) order by c.occurred_at desc) from public.relationship_communications c
      where c.tenant_id=v_tenant and c.opportunity_id=p_opportunity_id),'[]'::jsonb),
    'replyWorkflow',coalesce((select jsonb_agg(jsonb_build_object(
      'id',r.id,'status',r.status,'followUpDueAt',r.follow_up_due_at,'createdAt',r.created_at
    ) order by r.created_at desc) from public.relationship_replies r
      where r.tenant_id=v_tenant and r.opportunity_id=p_opportunity_id),'[]'::jsonb),
    'meetings',coalesce((select jsonb_agg(jsonb_build_object(
      'id',m.id,'eventStatus',m.event_status,'startsAt',m.starts_at,'endsAt',m.ends_at,
      'streamyardUrl',m.streamyard_url,'calendarId',m.calendar_id,'externalEventId',m.external_event_id
    ) order by m.starts_at desc nulls last) from public.relationship_meetings m
      where m.tenant_id=v_tenant and m.opportunity_id=p_opportunity_id),'[]'::jsonb),
    'issues',coalesce((select jsonb_agg(jsonb_build_object(
      'id',i.id,'issueType',i.issue_type,'severity',i.severity,'status',i.status,
      'summary',i.summary,'createdAt',i.created_at
    ) order by i.created_at desc) from public.relationship_reconciliation_issues i
      where i.tenant_id=v_tenant and i.opportunity_id=p_opportunity_id),'[]'::jsonb)
  );
end;
$function$;

create or replace function public.list_relationship_orchestration_integrity()
returns jsonb language plpgsql stable security definer set search_path to '' as $function$
declare
  v_context jsonb:=private.relationship_orchestration_context(false);
  v_tenant uuid:=(v_context->>'tenant_id')::uuid;
begin
  return jsonb_build_object(
    'flags',coalesce((select jsonb_object_agg(flag_name,enabled order by flag_name)
      from private.relationship_feature_flags where tenant_id=v_tenant),'{}'::jsonb),
    'connections',coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id',c.id,'connectionType',c.connection_type,'googleAccountEmail',c.google_account_email,
      'calendarId',c.calendar_id,'scopes',c.scopes,'status',c.status,
      'lastVerifiedAt',c.last_verified_at,'lastErrorCode',c.last_error_code,
      'lastErrorReason',c.last_error_reason,'watchExpiration',
        case when c.connection_type='gmail' then s.gmail_watch_expiration else ch.expiration end,
      'lastSuccessfulSyncAt',s.last_successful_sync_at,'lastFullReconciliationAt',s.last_full_reconciliation_at
    )) order by c.connection_type,c.created_at) from private.relationship_google_connections c
      left join private.relationship_google_sync_state s on s.connection_id=c.id
      left join private.relationship_calendar_channels ch on ch.connection_id=c.id
      where c.tenant_id=v_tenant and c.status<>'revoked'),'[]'::jsonb),
    'invariants',jsonb_build_object(
      'humanReplyBeforeResponded',(select count(*) from public.relationship_activity_events a
        join public.relationship_opportunities o on o.tenant_id=a.tenant_id and o.id=a.opportunity_id
        where a.tenant_id=v_tenant and a.activity_type='human_reply_received'
          and o.status=any(array['identified','researching','qualified','ready_for_campaign','contacted']::text[])),
      'respondedOrLaterWithActiveDelivery',(select count(*) from public.relationship_campaign_enrollments e
        join public.relationship_opportunities o on o.tenant_id=e.tenant_id and o.id=e.opportunity_id
        where e.tenant_id=v_tenant and e.campaign_id='50ec97e9-340d-4c1e-b2fd-2a3fc7fb649a'::uuid
          and o.status=any(array['responded','interested','recording_planned','booked','completed','declined','nurture','disqualified']::text[])
          and (e.delivery_enabled or e.status=any(array['pending','active','paused']::text[]))),
      'linkedRecordingBeforeBooked',(select count(*) from public.relationship_meetings m
        join public.relationship_opportunities o on o.tenant_id=m.tenant_id and o.id=m.opportunity_id
        where m.tenant_id=v_tenant and m.event_status<>'cancelled'
          and o.status<>all(array['booked','completed']::text[])),
      'completedWithActiveCampaignWork',(select count(*) from private.relationship_campaign_work_items w
        join public.relationship_campaign_enrollments e on e.tenant_id=w.tenant_id and e.id=w.enrollment_id
        join public.relationship_opportunities o on o.tenant_id=e.tenant_id and o.id=e.opportunity_id
        where w.tenant_id=v_tenant and o.status='completed'
          and w.status=any(array['planned','retry_wait','claimed']::text[])),
      'duplicateCanonicalCommunication',(select count(*) from (
        select rfc_message_id from public.relationship_message_observations
        where tenant_id=v_tenant and rfc_message_id is not null group by rfc_message_id
        having count(distinct communication_id)>1
      ) d)
    ),
    'issues',coalesce((select jsonb_agg(jsonb_build_object(
      'id',i.id,'issueType',i.issue_type,'severity',i.severity,'status',i.status,
      'opportunityId',i.opportunity_id,'source',i.source,'summary',i.summary,
      'details',i.details,'createdAt',i.created_at
    ) order by case i.severity when 'critical' then 1 when 'warning' then 2 else 3 end,i.created_at desc)
      from public.relationship_reconciliation_issues i where i.tenant_id=v_tenant and i.status='open'),'[]'::jsonb)
  );
end;
$function$;

create or replace function public.preview_relationship_bty_reconciliation()
returns jsonb language plpgsql stable security definer set search_path to '' as $function$
declare
  v_context jsonb:=private.relationship_orchestration_context(false);
  v_tenant uuid:=(v_context->>'tenant_id')::uuid;
begin
  return coalesce((
    with evidence as (
      select o.id as opportunity_id,o.status as current_status,
        exists(select 1 from public.relationship_communications c
          where c.tenant_id=o.tenant_id and c.opportunity_id=o.id and c.direction='outbound'
            and c.status=any(array['sent','delivered']::text[])) as successful_outbound,
        exists(select 1 from public.relationship_activity_events a
          where a.tenant_id=o.tenant_id and a.opportunity_id=o.id and a.activity_type='human_reply_received') as verified_human_reply,
        exists(select 1 from public.relationship_meetings m
          where m.tenant_id=o.tenant_id and m.opportunity_id=o.id and m.event_status<>'cancelled') as linked_recording,
        exists(select 1 from public.relationship_activity_events a
          where a.tenant_id=o.tenant_id and a.opportunity_id=o.id and a.activity_type='recording_completed') as explicit_completion
      from public.relationship_opportunities o where o.tenant_id=v_tenant
    ), proposals as (
      select *,case
        when explicit_completion and current_status='booked' then 'completed'
        when linked_recording and current_status<>all(array['booked','completed','declined','disqualified']::text[]) then 'booked'
        when verified_human_reply and current_status=any(array['identified','researching','qualified','ready_for_campaign','contacted']::text[]) then 'responded'
        when successful_outbound and current_status=any(array['identified','researching','qualified','ready_for_campaign']::text[]) then 'contacted'
        else null end as proposed_status,
        case
          when explicit_completion and current_status='booked' then 'explicit_completion'
          when linked_recording and current_status<>all(array['booked','completed','declined','disqualified']::text[]) then 'linked_recording'
          when verified_human_reply and current_status=any(array['identified','researching','qualified','ready_for_campaign','contacted']::text[]) then 'verified_human_reply'
          when successful_outbound and current_status=any(array['identified','researching','qualified','ready_for_campaign']::text[]) then 'successful_outbound'
        end as evidence_type
      from evidence
    )
    select jsonb_agg(jsonb_build_object(
      'opportunityId',opportunity_id,'currentStatus',current_status,'proposedStatus',proposed_status,
      'evidenceType',evidence_type,'evidence',jsonb_build_object(
        'successfulOutbound',successful_outbound,'verifiedHumanReply',verified_human_reply,
        'linkedRecording',linked_recording,'explicitCompletion',explicit_completion
      ),'algorithmVersion','bty_legacy_reconciliation_v1'
    ) order by opportunity_id) from proposals where proposed_status is not null
  ),'[]'::jsonb);
end;
$function$;

create or replace function public.apply_relationship_bty_reconciliation(
  p_batch_id uuid,p_items jsonb
)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare
  v_context jsonb:=private.relationship_orchestration_context(true);
  v_actor uuid:=(v_context->>'actor_id')::uuid;
  v_tenant uuid:=(v_context->>'tenant_id')::uuid;
  v_item jsonb;
  v_opportunity public.relationship_opportunities%rowtype;
  v_results jsonb:='[]'::jsonb;
begin
  if not private.relationship_flag_enabled(v_tenant,'relationship_reconciliation_writes_enabled') then
    raise exception 'Relationship reconciliation writes are disabled.' using errcode='42501';
  end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0
     or jsonb_array_length(p_items)>100 then
    raise exception 'Reconciliation requires between 1 and 100 reviewed items.' using errcode='22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    select * into v_opportunity from public.relationship_opportunities
    where tenant_id=v_tenant and id=(v_item->>'opportunityId')::uuid;
    if not found or v_opportunity.status is distinct from v_item->>'currentStatus' then
      raise exception 'Reconciliation opportunity changed after dry-run review.' using errcode='40001';
    end if;
    v_results:=v_results||jsonb_build_array(private.apply_relationship_activity(
      v_tenant,'legacy_reconciliation','reconciliation',
      format('legacy-reconciliation:%s:%s',p_batch_id,v_opportunity.id),p_batch_id::text,
      v_opportunity.organization_id,v_opportunity.primary_contact_id,v_opportunity.id,null,null,null,now(),
      jsonb_build_object('batch_id',p_batch_id,'prior_status',v_opportunity.status,
        'target_status',v_item->>'proposedStatus','evidence_type',v_item->>'evidenceType',
        'evidence',coalesce(v_item->'evidence','{}'::jsonb),
        'algorithm_version','bty_legacy_reconciliation_v1'),v_actor
    ));
  end loop;
  return v_results;
end;
$function$;

create or replace function public.create_relationship_google_oauth_state(
  p_tenant_id uuid,p_connection_type text,p_actor_profile_id uuid,p_state_hash text,
  p_code_verifier text,p_redirect_uri text,p_expires_at timestamptz
)
returns jsonb language plpgsql security definer set search_path to '' as $function$
begin
  if p_connection_type<>all(array['gmail','calendar']::text[]) or p_expires_at<=now()
     or p_expires_at>now()+interval '15 minutes' then
    raise exception 'Invalid relationship Google OAuth state.' using errcode='22023';
  end if;
  if not exists(select 1 from public.crm_user_capabilities c
    where c.tenant_id=p_tenant_id and c.profile_id=p_actor_profile_id
      and c.crm_role=any(array['crm_admin','crm_operator']::public.crm_capability_role[])) then
    raise exception 'CRM operator access is required.' using errcode='42501';
  end if;
  delete from private.relationship_google_oauth_states where expires_at<=now() or used_at is not null;
  insert into private.relationship_google_oauth_states(
    state_hash,tenant_id,connection_type,actor_profile_id,code_verifier,redirect_uri,expires_at
  ) values (p_state_hash,p_tenant_id,p_connection_type,p_actor_profile_id,p_code_verifier,p_redirect_uri,p_expires_at);
  return jsonb_build_object('created',true,'expiresAt',p_expires_at);
end;
$function$;

create or replace function public.consume_relationship_google_oauth_state(p_state_hash text)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare v_state private.relationship_google_oauth_states%rowtype;
begin
  select * into v_state from private.relationship_google_oauth_states
  where state_hash=p_state_hash for update;
  if not found or v_state.used_at is not null or v_state.expires_at<=now() then
    raise exception 'Google OAuth state is invalid or expired.' using errcode='42501';
  end if;
  update private.relationship_google_oauth_states set used_at=now() where state_hash=p_state_hash;
  return jsonb_build_object('tenantId',v_state.tenant_id,'connectionType',v_state.connection_type,
    'actorProfileId',v_state.actor_profile_id,'codeVerifier',v_state.code_verifier,
    'redirectUri',v_state.redirect_uri);
end;
$function$;

create or replace function public.store_relationship_google_connection(
  p_tenant_id uuid,p_connection_type text,p_google_account_email text,p_google_account_id text,
  p_calendar_id text,p_scopes text[],p_refresh_token text,p_actor_profile_id uuid
)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare
  v_connection private.relationship_google_connections%rowtype;
  v_secret_id uuid;
  v_email text:=lower(btrim(p_google_account_email));
begin
  if p_connection_type<>all(array['gmail','calendar']::text[]) then
    raise exception 'Invalid Google connection type.' using errcode='22023';
  end if;
  if p_connection_type='gmail' and v_email<>'info@valorwell.org' then
    raise exception 'Gmail connection must authenticate exactly info@valorwell.org.' using errcode='42501';
  end if;
  if not exists(select 1 from public.crm_user_capabilities c
    where c.tenant_id=p_tenant_id and c.profile_id=p_actor_profile_id
      and c.crm_role=any(array['crm_admin','crm_operator']::public.crm_capability_role[])) then
    raise exception 'CRM operator access is required.' using errcode='42501';
  end if;
  select * into v_connection from private.relationship_google_connections c
  where c.tenant_id=p_tenant_id and c.connection_type=p_connection_type
    and c.status<>'revoked'
    and (p_connection_type='gmail' or c.calendar_id=p_calendar_id)
  for update;
  if nullif(p_refresh_token,'') is null and not found then
    raise exception 'Google did not return an offline refresh token.' using errcode='22023';
  end if;
  if found then
    v_secret_id:=v_connection.refresh_token_secret_id;
    if nullif(p_refresh_token,'') is not null then
      perform vault.update_secret(v_secret_id,p_refresh_token,
        format('relationship-google-%s-%s',p_tenant_id,p_connection_type),
        'Encrypted relationship Google OAuth refresh token.');
    end if;
    update private.relationship_google_connections set
      google_account_email=v_email,google_account_id=nullif(p_google_account_id,''),
      calendar_id=case when p_connection_type='calendar' then p_calendar_id else null end,
      scopes=coalesce(p_scopes,'{}'::text[]),connected_by_profile_id=p_actor_profile_id,
      status='active',last_verified_at=now(),last_error_code=null,last_error_reason=null,
      revoked_at=null,updated_at=now()
    where id=v_connection.id returning * into v_connection;
  else
    v_secret_id:=vault.create_secret(p_refresh_token,
      format('relationship-google-%s-%s-%s',p_tenant_id,p_connection_type,gen_random_uuid()),
      'Encrypted relationship Google OAuth refresh token.');
    insert into private.relationship_google_connections(
      tenant_id,connection_type,google_account_email,google_account_id,calendar_id,scopes,
      refresh_token_secret_id,connected_by_profile_id,status,last_verified_at
    ) values (
      p_tenant_id,p_connection_type,v_email,nullif(p_google_account_id,''),
      case when p_connection_type='calendar' then p_calendar_id else null end,
      coalesce(p_scopes,'{}'::text[]),v_secret_id,p_actor_profile_id,'active',now()
    ) returning * into v_connection;
  end if;
  insert into private.relationship_google_sync_state(connection_id)
  values(v_connection.id) on conflict(connection_id) do nothing;
  return jsonb_build_object('id',v_connection.id,'connectionType',v_connection.connection_type,
    'googleAccountEmail',v_connection.google_account_email,'calendarId',v_connection.calendar_id,
    'scopes',v_connection.scopes,'status',v_connection.status,'lastVerifiedAt',v_connection.last_verified_at);
end;
$function$;

create or replace function public.get_relationship_google_connection_runtime(
  p_tenant_id uuid,p_connection_type text,p_connection_id uuid default null
)
returns jsonb language plpgsql stable security definer set search_path to '' as $function$
declare v_connection private.relationship_google_connections%rowtype; v_refresh text;
begin
  select * into v_connection from private.relationship_google_connections c
  where c.tenant_id=p_tenant_id and c.connection_type=p_connection_type and c.status='active'
    and (p_connection_id is null or c.id=p_connection_id)
  order by c.updated_at desc limit 1;
  if not found then return null; end if;
  select decrypted_secret into v_refresh from vault.decrypted_secrets
  where id=v_connection.refresh_token_secret_id;
  return jsonb_build_object('id',v_connection.id,'tenantId',v_connection.tenant_id,
    'connectionType',v_connection.connection_type,'googleAccountEmail',v_connection.google_account_email,
    'googleAccountId',v_connection.google_account_id,'calendarId',v_connection.calendar_id,
    'scopes',v_connection.scopes,'refreshToken',v_refresh);
end;
$function$;

create or replace function public.get_relationship_observation_flags(p_tenant_id uuid)
returns jsonb language sql stable security definer set search_path to '' as $function$
  select jsonb_build_object(
    'gmail',private.relationship_flag_enabled(p_tenant_id,'relationship_gmail_observation_enabled'),
    'calendar',private.relationship_flag_enabled(p_tenant_id,'relationship_calendar_observation_enabled')
  );
$function$;

create or replace function public.get_relationship_google_sync_state(p_connection_id uuid)
returns jsonb language sql stable security definer set search_path to '' as $function$
  select jsonb_strip_nulls(jsonb_build_object(
    'connectionId',s.connection_id,'gmailHistoryId',s.gmail_history_id,
    'gmailWatchExpiration',s.gmail_watch_expiration,'calendarSyncToken',s.calendar_sync_token,
    'lastNotificationAt',s.last_notification_at,'lastSuccessfulSyncAt',s.last_successful_sync_at,
    'lastFullReconciliationAt',s.last_full_reconciliation_at,'syncLockedUntil',s.sync_locked_until,
    'lastErrorCode',s.last_error_code,'lastErrorReason',s.last_error_reason
  )) from private.relationship_google_sync_state s where s.connection_id=p_connection_id;
$function$;

create or replace function public.update_relationship_google_sync_state(
  p_connection_id uuid,p_gmail_history_id text default null,p_gmail_watch_expiration timestamptz default null,
  p_calendar_sync_token text default null,p_notification boolean default false,
  p_success boolean default false,p_full_reconciliation boolean default false,
  p_error_code text default null,p_error_reason text default null
)
returns jsonb language plpgsql security definer set search_path to '' as $function$
begin
  insert into private.relationship_google_sync_state(connection_id) values(p_connection_id)
  on conflict(connection_id) do nothing;
  update private.relationship_google_sync_state set
    gmail_history_id=coalesce(p_gmail_history_id,gmail_history_id),
    gmail_watch_expiration=coalesce(p_gmail_watch_expiration,gmail_watch_expiration),
    calendar_sync_token=coalesce(p_calendar_sync_token,calendar_sync_token),
    last_notification_at=case when p_notification then now() else last_notification_at end,
    last_successful_sync_at=case when p_success then now() else last_successful_sync_at end,
    last_full_reconciliation_at=case when p_full_reconciliation then now() else last_full_reconciliation_at end,
    last_error_code=p_error_code,last_error_reason=p_error_reason,updated_at=now()
  where connection_id=p_connection_id;
  return public.get_relationship_google_sync_state(p_connection_id);
end;
$function$;

create or replace function public.get_relationship_calendar_channel(p_connection_id uuid)
returns jsonb language sql stable security definer set search_path to '' as $function$
  select jsonb_build_object('connectionId',connection_id,'channelId',channel_id,
    'channelToken',channel_token,'resourceId',resource_id,'expiration',expiration)
  from private.relationship_calendar_channels where connection_id=p_connection_id;
$function$;

create or replace function public.validate_relationship_calendar_channel(
  p_channel_id uuid,p_resource_id text,p_channel_token text
)
returns jsonb language sql stable security definer set search_path to '' as $function$
  select jsonb_build_object('valid',true,'connectionId',c.connection_id,'expiration',c.expiration)
  from private.relationship_calendar_channels c
  where c.channel_id=p_channel_id and c.resource_id=p_resource_id
    and c.channel_token=p_channel_token and c.expiration>now();
$function$;

create or replace function public.store_relationship_calendar_channel(
  p_connection_id uuid,p_channel_id uuid,p_channel_token text,p_resource_id text,p_expiration timestamptz
)
returns jsonb language plpgsql security definer set search_path to '' as $function$
begin
  insert into private.relationship_calendar_channels(
    connection_id,channel_id,channel_token,resource_id,expiration
  ) values(p_connection_id,p_channel_id,p_channel_token,p_resource_id,p_expiration)
  on conflict(connection_id) do update set channel_id=excluded.channel_id,
    channel_token=excluded.channel_token,resource_id=excluded.resource_id,
    expiration=excluded.expiration,updated_at=now();
  return public.get_relationship_calendar_channel(p_connection_id);
end;
$function$;

-- Preserve delivery mechanics and route the successful-send consequence through the activity engine.
do $migration$
begin
  if to_regprocedure('private.record_relationship_delivery_result_pre_bty(uuid,uuid,text,text,text,text,timestamptz,text,text)') is null then
    alter function private.record_relationship_delivery_result(uuid,uuid,text,text,text,text,timestamptz,text,text)
      rename to record_relationship_delivery_result_pre_bty;
  end if;
end
$migration$;

create or replace function private.record_relationship_delivery_result(
  p_communication_id uuid,p_claim_token uuid,p_outcome text,p_idempotency_key text,
  p_provider_message_id text default null,p_provider_thread_id text default null,
  p_retry_at timestamptz default null,p_error_code text default null,p_error_message text default null
)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare
  v_result jsonb;
  v_comm public.relationship_communications%rowtype;
  v_activity jsonb;
begin
  v_result:=private.record_relationship_delivery_result_pre_bty(
    p_communication_id,p_claim_token,p_outcome,p_idempotency_key,p_provider_message_id,
    p_provider_thread_id,p_retry_at,p_error_code,p_error_message
  );
  if p_outcome='sent' then
    select * into v_comm from public.relationship_communications where id=p_communication_id;
    insert into public.relationship_message_observations(
      tenant_id,communication_id,source,provider_message_id,provider_thread_id,observed_at,metadata
    ) values (
      v_comm.tenant_id,v_comm.id,'resend',p_provider_message_id,nullif(p_provider_thread_id,''),
      coalesce(v_comm.sent_at,now()),jsonb_build_object('delivery_result_idempotency_key',p_idempotency_key)
    ) on conflict(tenant_id,source,provider_message_id) do nothing;
    if v_comm.opportunity_id is not null then
      v_activity:=private.apply_relationship_activity(
        v_comm.tenant_id,'outreach_sent','resend','resend-send:'||p_provider_message_id,
        p_provider_message_id,v_comm.organization_id,v_comm.contact_id,v_comm.opportunity_id,
        v_comm.campaign_id,v_comm.enrollment_id,v_comm.id,coalesce(v_comm.sent_at,now()),
        jsonb_build_object('provider','resend','provider_message_id',p_provider_message_id),null
      );
    end if;
  end if;
  return v_result||jsonb_build_object('relationshipActivity',v_activity);
end;
$function$;

create or replace function public.record_relationship_delivery_result(
  p_communication_id uuid,p_claim_token uuid,p_outcome text,p_idempotency_key text,
  p_provider_message_id text default null,p_provider_thread_id text default null,
  p_retry_at timestamptz default null,p_error_code text default null,p_error_message text default null
)
returns jsonb language sql security definer set search_path to '' as $function$
  select private.record_relationship_delivery_result(
    p_communication_id,p_claim_token,p_outcome,p_idempotency_key,p_provider_message_id,
    p_provider_thread_id,p_retry_at,p_error_code,p_error_message
  );
$function$;

create or replace function private.ingest_relationship_inbound_reply(
  p_provider text,p_provider_event_id text,p_provider_message_id text,p_provider_thread_id text,
  p_outbound_communication_id uuid,p_in_reply_to_provider_message_id text,p_from_email text,p_to_email text,
  p_subject text,p_body text,p_occurred_at timestamptz,p_payload jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare
  v_outbound public.relationship_communications%rowtype;
  v_inbound public.relationship_communications%rowtype;
  v_existing_event public.relationship_communication_events%rowtype;
  v_tenant uuid;
  v_reply_id uuid;
  v_classification text;
  v_headers jsonb:=coalesce(p_payload->'received_headers',p_payload->'headers','{}'::jsonb);
  v_rfc_id text:=private.relationship_header_value(v_headers,'message-id');
  v_stop boolean:=true;
  v_enrollment public.relationship_campaign_enrollments%rowtype;
  v_activity jsonb;
begin
  if lower(btrim(p_provider))<>all(array['resend','gmail']::text[]) then
    raise exception 'Unsupported relationship inbound provider.' using errcode='22023';
  end if;
  if nullif(btrim(p_provider_event_id),'') is null or nullif(btrim(p_provider_message_id),'') is null then
    raise exception 'Inbound provider event and message IDs are required.' using errcode='22023';
  end if;
  if lower(btrim(p_from_email)) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or lower(btrim(p_to_email)) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Valid inbound sender and recipient emails are required.' using errcode='22023';
  end if;
  if length(coalesce(p_body,''))>1048576 then
    raise exception 'Inbound reply body exceeds the supported size.' using errcode='22023';
  end if;
  select * into v_existing_event from public.relationship_communication_events
  where provider=lower(btrim(p_provider)) and provider_event_id=btrim(p_provider_event_id);
  if found then
    select r.id into v_reply_id from public.relationship_replies r
    where r.tenant_id=v_existing_event.tenant_id and r.communication_id=v_existing_event.communication_id;
    return jsonb_build_object('replayed',true,'matched',true,'classification',
      case when v_reply_id is null then 'automated' else 'human' end,'replyId',v_reply_id);
  end if;

  if p_outbound_communication_id is not null then
    select * into v_outbound from public.relationship_communications c
    where c.id=p_outbound_communication_id and c.direction='outbound'
      and lower(c.recipient_email)=lower(btrim(p_from_email));
  end if;
  if not found and nullif(btrim(p_in_reply_to_provider_message_id),'') is not null then
    select c.* into v_outbound from public.relationship_communications c
    where c.direction='outbound' and lower(c.recipient_email)=lower(btrim(p_from_email))
      and (c.provider_message_id=btrim(p_in_reply_to_provider_message_id)
        or c.id in (select o.communication_id from public.relationship_message_observations o
          where o.provider_message_id=btrim(p_in_reply_to_provider_message_id)
             or o.rfc_message_id=btrim(p_in_reply_to_provider_message_id)))
    order by c.sent_at desc nulls last limit 1;
  end if;
  if not found and nullif(btrim(p_provider_thread_id),'') is not null then
    select c.* into v_outbound from public.relationship_communications c
    where c.direction='outbound' and lower(c.recipient_email)=lower(btrim(p_from_email))
      and c.id in (select o.communication_id from public.relationship_message_observations o
        where o.provider_thread_id=btrim(p_provider_thread_id))
    order by c.sent_at desc nulls last limit 1;
  end if;

  if not found then
    select c.tenant_id into v_tenant from private.relationship_delivery_provider_configs c
    where lower(c.inbound_address)=lower(btrim(p_to_email)) limit 1;
    if v_tenant is null and lower(btrim(p_to_email))='info@valorwell.org' then
      select tenant_id into v_tenant from private.relationship_google_connections
      where connection_type='gmail' and google_account_email='info@valorwell.org' and status='active' limit 1;
    end if;
    if v_tenant is not null then
      v_activity:=private.apply_relationship_activity(
        v_tenant,'human_reply_received',lower(btrim(p_provider)),
        format('%s-inbound-unmatched:%s',lower(btrim(p_provider)),p_provider_event_id),p_provider_event_id,
        null,null,null,null,null,null,coalesce(p_occurred_at,now()),
        jsonb_build_object('provider_message_id',p_provider_message_id,'from_email',lower(btrim(p_from_email)),
          'to_email',lower(btrim(p_to_email)),'subject',left(coalesce(p_subject,''),500)),null
      );
    end if;
    return jsonb_build_object('replayed',false,'matched',false,'classification','ambiguous','activity',v_activity);
  end if;
  v_tenant:=v_outbound.tenant_id;
  v_classification:=private.classify_relationship_email(v_headers,p_subject,p_from_email);

  if v_rfc_id is not null then
    select c.* into v_inbound from public.relationship_message_observations o
    join public.relationship_communications c on c.tenant_id=o.tenant_id and c.id=o.communication_id
    where o.tenant_id=v_tenant and o.rfc_message_id=v_rfc_id and c.direction='inbound'
    order by o.observed_at limit 1;
  end if;
  if not found then
    select * into v_inbound from public.relationship_communications
    where provider=lower(btrim(p_provider)) and provider_message_id=btrim(p_provider_message_id);
  end if;
  if not found then
    insert into public.relationship_communications(
      tenant_id,campaign_id,campaign_step_id,enrollment_id,organization_id,contact_id,opportunity_id,
      direction,channel,status,sender_email,recipient_email,subject,rendered_body,provider,
      provider_message_id,provider_thread_id,occurred_at,metadata
    ) values (
      v_tenant,v_outbound.campaign_id,v_outbound.campaign_step_id,v_outbound.enrollment_id,
      v_outbound.organization_id,v_outbound.contact_id,v_outbound.opportunity_id,
      'inbound','email','received',lower(btrim(p_from_email)),lower(btrim(p_to_email)),
      nullif(p_subject,''),coalesce(p_body,''),lower(btrim(p_provider)),btrim(p_provider_message_id),
      nullif(btrim(p_provider_thread_id),''),coalesce(p_occurred_at,now()),
      jsonb_build_object('in_reply_to_communication_id',v_outbound.id,'classification',v_classification)
    ) returning * into v_inbound;
  end if;
  insert into public.relationship_message_observations(
    tenant_id,communication_id,source,provider_message_id,provider_thread_id,rfc_message_id,observed_at,metadata
  ) values (
    v_tenant,v_inbound.id,lower(btrim(p_provider)),btrim(p_provider_message_id),
    nullif(btrim(p_provider_thread_id),''),v_rfc_id,coalesce(p_occurred_at,now()),
    jsonb_build_object('classification',v_classification)
  ) on conflict(tenant_id,source,provider_message_id) do nothing;
  insert into public.relationship_communication_events(
    tenant_id,communication_id,provider,provider_event_id,event_type,occurred_at,payload
  ) values (
    v_tenant,v_inbound.id,lower(btrim(p_provider)),btrim(p_provider_event_id),'email.received',
    coalesce(p_occurred_at,now()),coalesce(p_payload,'{}'::jsonb)
  ) on conflict(provider,provider_event_id) where provider_event_id is not null do nothing;

  if v_classification='human' then
    insert into public.relationship_replies(
      tenant_id,communication_id,enrollment_id,organization_id,contact_id,opportunity_id,status,metadata
    ) values (
      v_tenant,v_inbound.id,v_inbound.enrollment_id,v_inbound.organization_id,
      v_inbound.contact_id,v_inbound.opportunity_id,'new',jsonb_build_object('outbound_communication_id',v_outbound.id)
    ) on conflict(communication_id) do update set updated_at=public.relationship_replies.updated_at
    returning id into v_reply_id;
    select stop_on_reply into v_stop from public.relationship_campaign_steps
    where tenant_id=v_tenant and id=v_outbound.campaign_step_id;
    if coalesce(v_stop,true) and v_outbound.enrollment_id is not null then
      select * into v_enrollment from public.relationship_campaign_enrollments
      where tenant_id=v_tenant and id=v_outbound.enrollment_id for update;
      if found and v_enrollment.status=any(array['pending','active','paused']::text[]) then
        update public.relationship_campaign_enrollments set status='responded',
          responded_at=coalesce(p_occurred_at,now()),delivery_enabled=false,next_scheduled_at=null
        where id=v_enrollment.id;
        update private.relationship_campaign_work_items set status='cancelled',claim_token=null,
          claimed_by=null,claimed_at=null,lease_expires_at=null,updated_at=now(),
          metadata=metadata||jsonb_build_object('cancelled_by_reply_id',v_reply_id)
        where tenant_id=v_tenant and enrollment_id=v_enrollment.id
          and status=any(array['planned','retry_wait','claimed']::text[]);
        insert into public.relationship_enrollment_events(
          tenant_id,enrollment_id,event_type,from_status,to_status,reason,metadata
        ) values (
          v_tenant,v_enrollment.id,'reply_received',v_enrollment.status,'responded',
          'Verified human inbound reply stopped remaining relationship campaign work.',
          jsonb_build_object('reply_id',v_reply_id,'communication_id',v_inbound.id)
        );
      end if;
    end if;
    insert into public.relationship_interactions(
      tenant_id,organization_id,contact_id,opportunity_id,interaction_type,occurred_at,summary,metadata
    ) values (
      v_tenant,v_outbound.organization_id,v_outbound.contact_id,v_outbound.opportunity_id,
      'inbound_reply',coalesce(p_occurred_at,now()),coalesce(nullif(p_subject,''),'Inbound relationship reply received.'),
      jsonb_build_object('reply_id',v_reply_id,'communication_id',v_inbound.id,'classification','human')
    );
  else
    insert into public.relationship_interactions(
      tenant_id,organization_id,contact_id,opportunity_id,interaction_type,occurred_at,summary,metadata
    ) values (
      v_tenant,v_outbound.organization_id,v_outbound.contact_id,v_outbound.opportunity_id,
      'system',coalesce(p_occurred_at,now()),'Automated inbound response recorded without changing BTY lifecycle.',
      jsonb_build_object('communication_id',v_inbound.id,'classification','automated')
    );
  end if;
  v_activity:=private.apply_relationship_activity(
    v_tenant,case when v_classification='human' then 'human_reply_received' else 'automated_reply_received' end,
    lower(btrim(p_provider)),format('%s-inbound:%s',lower(btrim(p_provider)),p_provider_event_id),p_provider_event_id,
    v_outbound.organization_id,v_outbound.contact_id,v_outbound.opportunity_id,v_outbound.campaign_id,
    v_outbound.enrollment_id,v_inbound.id,coalesce(p_occurred_at,now()),
    jsonb_build_object('classification',v_classification,'reply_id',v_reply_id,'outbound_communication_id',v_outbound.id),null
  );
  return jsonb_build_object('replayed',false,'matched',true,'classification',v_classification,
    'replyId',v_reply_id,'communicationId',v_inbound.id,'activity',v_activity);
end;
$function$;

create or replace function public.ingest_relationship_inbound_reply(
  p_provider text,p_provider_event_id text,p_provider_message_id text,p_provider_thread_id text,
  p_outbound_communication_id uuid,p_in_reply_to_provider_message_id text,p_from_email text,p_to_email text,
  p_subject text,p_body text,p_occurred_at timestamptz,p_payload jsonb default '{}'::jsonb
)
returns jsonb language sql security definer set search_path to '' as $function$
  select private.ingest_relationship_inbound_reply(
    p_provider,p_provider_event_id,p_provider_message_id,p_provider_thread_id,
    p_outbound_communication_id,p_in_reply_to_provider_message_id,p_from_email,p_to_email,
    p_subject,p_body,p_occurred_at,p_payload
  );
$function$;

create or replace function private.resolve_relationship_gmail_message(
  p_tenant_id uuid,p_gmail_message_id text,p_gmail_thread_id text,p_headers jsonb,
  p_from_email text,p_to_emails text[],p_subject text
)
returns jsonb language plpgsql stable security definer set search_path to '' as $function$
declare
  v_comm_id uuid;
  v_candidates uuid[];
  v_hint text:=private.relationship_header_value(p_headers,'x-relationship-communication-id');
  v_rfc text:=private.relationship_header_value(p_headers,'message-id');
  v_reply text:=private.relationship_header_value(p_headers,'in-reply-to');
  v_refs text:=coalesce(private.relationship_header_value(p_headers,'references'),'');
  v_direction text:=case when lower(btrim(p_from_email))='info@valorwell.org' then 'outbound' else 'inbound' end;
  v_counterparty text;
  v_likely boolean:=false;
begin
  select o.communication_id into v_comm_id from public.relationship_message_observations o
  where o.tenant_id=p_tenant_id and o.source='gmail' and o.provider_message_id=p_gmail_message_id;
  if found then return jsonb_build_object('matched',true,'physicalExisting',true,
    'communicationId',v_comm_id,'direction',v_direction,'classification',
    private.classify_relationship_email(p_headers,p_subject,p_from_email)); end if;
  if v_rfc is not null then
    select o.communication_id into v_comm_id from public.relationship_message_observations o
    where o.tenant_id=p_tenant_id and o.rfc_message_id=v_rfc order by o.observed_at limit 1;
    if found then return jsonb_build_object('matched',true,'physicalExisting',true,
      'communicationId',v_comm_id,'direction',v_direction,'classification',
      private.classify_relationship_email(p_headers,p_subject,p_from_email)); end if;
  end if;
  if v_hint ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    select id into v_comm_id from public.relationship_communications
    where tenant_id=p_tenant_id and id=v_hint::uuid;
    if found then return jsonb_build_object('matched',true,'physicalExisting',v_direction='outbound',
      'communicationId',v_comm_id,'direction',v_direction,'classification',
      private.classify_relationship_email(p_headers,p_subject,p_from_email)); end if;
  end if;
  if v_reply is not null or v_refs<>'' then
    select array_agg(distinct o.communication_id) into v_candidates
    from public.relationship_message_observations o
    join public.relationship_communications c on c.tenant_id=o.tenant_id and c.id=o.communication_id
    where o.tenant_id=p_tenant_id and c.direction='outbound' and o.rfc_message_id is not null
      and (o.rfc_message_id=v_reply or position(o.rfc_message_id in v_refs)>0);
    if cardinality(v_candidates)=1 then v_comm_id:=v_candidates[1]; end if;
    if cardinality(v_candidates)>1 then return jsonb_build_object('matched',false,'ambiguous',true,
      'direction',v_direction,'classification',private.classify_relationship_email(p_headers,p_subject,p_from_email)); end if;
  end if;
  if v_comm_id is null and nullif(btrim(p_gmail_thread_id),'') is not null then
    select array_agg(distinct o.communication_id) into v_candidates
    from public.relationship_message_observations o
    where o.tenant_id=p_tenant_id and o.source='gmail' and o.provider_thread_id=p_gmail_thread_id;
    if cardinality(v_candidates)=1 then v_comm_id:=v_candidates[1]; end if;
    if cardinality(v_candidates)>1 then return jsonb_build_object('matched',false,'ambiguous',true,
      'direction',v_direction,'classification',private.classify_relationship_email(p_headers,p_subject,p_from_email)); end if;
  end if;
  if v_comm_id is not null then return jsonb_build_object('matched',true,'physicalExisting',false,
    'communicationId',v_comm_id,'direction',v_direction,'classification',
    private.classify_relationship_email(p_headers,p_subject,p_from_email)); end if;
  v_counterparty:=case when v_direction='inbound' then lower(btrim(p_from_email)) else
    (select lower(btrim(x)) from unnest(coalesce(p_to_emails,'{}'::text[])) x
     where lower(btrim(x))<>'info@valorwell.org' limit 1) end;
  select exists(select 1 from public.relationship_contacts c
    where c.tenant_id=p_tenant_id and lower(c.email)=v_counterparty) into v_likely;
  return jsonb_build_object('matched',false,'ambiguous',v_likely,'likelyRelationship',v_likely,
    'direction',v_direction,'classification',private.classify_relationship_email(p_headers,p_subject,p_from_email));
end;
$function$;

create or replace function public.match_relationship_gmail_message(
  p_tenant_id uuid,p_gmail_message_id text,p_gmail_thread_id text,p_headers jsonb,
  p_from_email text,p_to_emails text[],p_subject text
)
returns jsonb language plpgsql stable security definer set search_path to '' as $function$
begin
  if not private.relationship_flag_enabled(p_tenant_id,'relationship_gmail_observation_enabled') then
    return jsonb_build_object('matched',false,'observationEnabled',false,'shouldFetchFull',false);
  end if;
  return private.resolve_relationship_gmail_message(
    p_tenant_id,p_gmail_message_id,p_gmail_thread_id,p_headers,p_from_email,p_to_emails,p_subject
  )||jsonb_build_object('observationEnabled',true,'shouldFetchFull',
    coalesce((private.resolve_relationship_gmail_message(
      p_tenant_id,p_gmail_message_id,p_gmail_thread_id,p_headers,p_from_email,p_to_emails,p_subject
    )->>'matched')::boolean,false));
end;
$function$;

create or replace function public.ingest_relationship_gmail_message(
  p_tenant_id uuid,p_gmail_message_id text,p_gmail_thread_id text,p_headers jsonb,
  p_from_email text,p_to_emails text[],p_subject text,p_body text,p_occurred_at timestamptz,
  p_label_ids text[] default '{}'::text[]
)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare
  v_match jsonb;
  v_anchor public.relationship_communications%rowtype;
  v_comm public.relationship_communications%rowtype;
  v_direction text;
  v_rfc text:=private.relationship_header_value(p_headers,'message-id');
  v_in_reply text:=private.relationship_header_value(p_headers,'in-reply-to');
  v_recipient text;
  v_activity jsonb;
begin
  if not private.relationship_flag_enabled(p_tenant_id,'relationship_gmail_observation_enabled') then
    return jsonb_build_object('observed',false,'reason','relationship_gmail_observation_disabled');
  end if;
  if lower(btrim(p_from_email))<>'info@valorwell.org'
     and not exists(select 1 from unnest(coalesce(p_to_emails,'{}'::text[])) x
       where lower(btrim(x))='info@valorwell.org') then
    return jsonb_build_object('observed',false,'reason','mailbox_not_authoritative');
  end if;
  v_match:=private.resolve_relationship_gmail_message(
    p_tenant_id,p_gmail_message_id,p_gmail_thread_id,p_headers,p_from_email,p_to_emails,p_subject
  );
  v_direction:=v_match->>'direction';
  if coalesce((v_match->>'matched')::boolean,false) is not true then
    if coalesce((v_match->>'likelyRelationship')::boolean,false) or coalesce((v_match->>'ambiguous')::boolean,false) then
      perform private.open_relationship_reconciliation_issue(
        p_tenant_id,'ambiguous_email_thread','gmail','Likely relationship Gmail message could not be matched defensibly.',
        p_gmail_message_id,null,null,jsonb_build_object('gmail_thread_id',p_gmail_thread_id,
          'from_email',lower(btrim(p_from_email)),'subject',left(coalesce(p_subject,''),500))
      );
    end if;
    return jsonb_build_object('observed',false,'matched',false,'ambiguous',v_match->'ambiguous');
  end if;
  select * into v_anchor from public.relationship_communications
  where tenant_id=p_tenant_id and id=(v_match->>'communicationId')::uuid;
  if coalesce((v_match->>'physicalExisting')::boolean,false) then
    insert into public.relationship_message_observations(
      tenant_id,communication_id,source,provider_message_id,provider_thread_id,rfc_message_id,observed_at,metadata
    ) values (
      p_tenant_id,v_anchor.id,'gmail',p_gmail_message_id,p_gmail_thread_id,v_rfc,
      coalesce(p_occurred_at,now()),jsonb_build_object('labels',to_jsonb(coalesce(p_label_ids,'{}'::text[])))
    ) on conflict(tenant_id,source,provider_message_id) do nothing;
    return jsonb_build_object('observed',true,'deduplicated',true,'communicationId',v_anchor.id);
  end if;
  if v_direction='inbound' then
    return private.ingest_relationship_inbound_reply(
      'gmail',p_gmail_message_id,p_gmail_message_id,p_gmail_thread_id,v_anchor.id,v_in_reply,
      p_from_email,'info@valorwell.org',p_subject,coalesce(p_body,''),p_occurred_at,
      jsonb_build_object('received_headers',p_headers,'label_ids',to_jsonb(coalesce(p_label_ids,'{}'::text[])))
    );
  end if;
  v_recipient:=(select lower(btrim(x)) from unnest(coalesce(p_to_emails,'{}'::text[])) x
    where lower(btrim(x))<>'info@valorwell.org' limit 1);
  insert into public.relationship_communications(
    tenant_id,campaign_id,enrollment_id,organization_id,contact_id,opportunity_id,
    direction,channel,status,sender_email,recipient_email,subject,rendered_body,provider,
    provider_message_id,provider_thread_id,occurred_at,sent_at,metadata
  ) values (
    p_tenant_id,v_anchor.campaign_id,v_anchor.enrollment_id,v_anchor.organization_id,
    v_anchor.contact_id,v_anchor.opportunity_id,'outbound','email','sent','info@valorwell.org',
    v_recipient,nullif(p_subject,''),coalesce(p_body,''),'gmail',p_gmail_message_id,p_gmail_thread_id,
    coalesce(p_occurred_at,now()),coalesce(p_occurred_at,now()),jsonb_build_object('manual_gmail_send',true)
  ) returning * into v_comm;
  insert into public.relationship_message_observations(
    tenant_id,communication_id,source,provider_message_id,provider_thread_id,rfc_message_id,observed_at,metadata
  ) values (
    p_tenant_id,v_comm.id,'gmail',p_gmail_message_id,p_gmail_thread_id,v_rfc,
    coalesce(p_occurred_at,now()),jsonb_build_object('manual_gmail_send',true)
  );
  insert into public.relationship_interactions(
    tenant_id,organization_id,contact_id,opportunity_id,interaction_type,occurred_at,summary,metadata
  ) values (
    p_tenant_id,v_comm.organization_id,v_comm.contact_id,v_comm.opportunity_id,'outbound_email',
    v_comm.occurred_at,coalesce(v_comm.subject,'Manual Gmail relationship email sent.'),
    jsonb_build_object('communication_id',v_comm.id,'provider','gmail','manual',true)
  );
  v_activity:=private.apply_relationship_activity(
    p_tenant_id,'manual_outbound_email','gmail','gmail-message:'||p_gmail_message_id,p_gmail_message_id,
    v_comm.organization_id,v_comm.contact_id,v_comm.opportunity_id,v_comm.campaign_id,
    v_comm.enrollment_id,v_comm.id,v_comm.occurred_at,jsonb_build_object('gmail_thread_id',p_gmail_thread_id),null
  );
  return jsonb_build_object('observed',true,'deduplicated',false,'communicationId',v_comm.id,'activity',v_activity);
end;
$function$;

create or replace function public.ingest_relationship_calendar_event(
  p_tenant_id uuid,p_connection_id uuid,p_calendar_id text,p_external_event_id text,p_ical_uid text,
  p_event_status text,p_starts_at timestamptz,p_ends_at timestamptz,p_attendee_emails text[],
  p_streamyard_url text,p_summary text,p_updated_at timestamptz,p_metadata jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare
  v_meeting public.relationship_meetings%rowtype;
  v_old_start timestamptz;
  v_candidates uuid[];
  v_opportunity public.relationship_opportunities%rowtype;
  v_activity_type text;
  v_activity jsonb;
begin
  if not private.relationship_flag_enabled(p_tenant_id,'relationship_calendar_observation_enabled') then
    return jsonb_build_object('observed',false,'reason','relationship_calendar_observation_disabled');
  end if;
  if p_event_status<>all(array['confirmed','tentative','cancelled']::text[]) then
    return jsonb_build_object('observed',false,'reason','unsupported_event_status');
  end if;
  select * into v_meeting from public.relationship_meetings
  where tenant_id=p_tenant_id and calendar_id=p_calendar_id and external_event_id=p_external_event_id
  for update;
  if found then
    v_old_start:=v_meeting.starts_at;
    update public.relationship_meetings set ical_uid=coalesce(p_ical_uid,ical_uid),
      starts_at=p_starts_at,ends_at=p_ends_at,event_status=p_event_status,last_synced_at=now(),
      metadata=coalesce(p_metadata,'{}'::jsonb),updated_at=now()
    where id=v_meeting.id returning * into v_meeting;
    v_activity_type:=case when p_event_status='cancelled' then 'recording_cancelled'
      when v_old_start is distinct from p_starts_at then 'recording_rescheduled' else 'recording_booked' end;
  else
    if p_event_status='cancelled' then
      return jsonb_build_object('observed',false,'reason','unlinked_cancelled_event');
    end if;
    if p_streamyard_url<>'https://streamyard.com/frr4zf8e3s' then
      return jsonb_build_object('observed',false,'reason','streamyard_room_not_present');
    end if;
    select array_agg(distinct o.id order by o.id) into v_candidates
    from public.relationship_opportunities o
    join public.relationship_contacts c on c.tenant_id=o.tenant_id and c.id=o.primary_contact_id
    where o.tenant_id=p_tenant_id
      and lower(c.email)=any(array(select lower(btrim(x)) from unnest(coalesce(p_attendee_emails,'{}'::text[])) x))
      and o.status<>all(array['completed','declined','disqualified']::text[]);
    if coalesce(cardinality(v_candidates),0)<>1 then
      if coalesce(cardinality(v_candidates),0)>1 then
        perform private.open_relationship_reconciliation_issue(
          p_tenant_id,'ambiguous_calendar_event','google_calendar',
          'StreamYard Calendar event matched more than one viable BTY opportunity.',p_external_event_id,
          null,null,jsonb_build_object('calendar_id',p_calendar_id,'candidate_opportunity_ids',to_jsonb(v_candidates),
            'summary',left(coalesce(p_summary,''),500))
        );
      end if;
      return jsonb_build_object('observed',false,'matched',false,'ambiguous',coalesce(cardinality(v_candidates),0)>1);
    end if;
    select * into v_opportunity from public.relationship_opportunities where id=v_candidates[1];
    insert into public.relationship_meetings(
      tenant_id,opportunity_id,organization_id,contact_id,purpose,connection_id,calendar_id,
      external_event_id,ical_uid,starts_at,ends_at,event_status,streamyard_url,last_synced_at,metadata
    ) values (
      p_tenant_id,v_opportunity.id,v_opportunity.organization_id,v_opportunity.primary_contact_id,
      'bty_recording',p_connection_id,p_calendar_id,p_external_event_id,p_ical_uid,p_starts_at,p_ends_at,
      p_event_status,'https://streamyard.com/frr4zf8e3s',now(),coalesce(p_metadata,'{}'::jsonb)
    ) returning * into v_meeting;
    v_activity_type:=case when p_event_status='cancelled' then 'recording_cancelled' else 'recording_booked' end;
  end if;
  v_activity:=private.apply_relationship_activity(
    p_tenant_id,v_activity_type,'google_calendar',
    format('calendar:%s:%s:%s',p_calendar_id,p_external_event_id,coalesce(p_updated_at,now())),
    p_external_event_id,v_meeting.organization_id,v_meeting.contact_id,v_meeting.opportunity_id,
    null,null,null,coalesce(p_updated_at,now()),
    jsonb_build_object('meeting_id',v_meeting.id,'calendar_id',p_calendar_id,
      'external_event_id',p_external_event_id,'starts_at',p_starts_at,'event_status',p_event_status),null
  );
  return jsonb_build_object('observed',true,'matched',true,'meetingId',v_meeting.id,
    'activityType',v_activity_type,'activity',v_activity);
end;
$function$;

create or replace function private.run_relationship_google_maintenance()
returns bigint language plpgsql security definer set search_path to '' as $function$
declare v_token text; v_request_id bigint;
begin
  select nullif(metadata->>'worker_token','') into v_token
  from private.relationship_delivery_provider_configs
  where tenant_id='00000000-0000-0000-0000-000000000001'::uuid
    and provider='resend' and status=any(array['test','ready']::text[]);
  if v_token is null then return null; end if;
  select net.http_post(
    url:='https://ahqauomkgflopxgnlndd.supabase.co/functions/v1/relationship-google-maintenance',
    body:=jsonb_build_object('mode','scheduled'),
    headers:=jsonb_build_object('Content-Type','application/json','X-Relationship-Worker-Token',v_token),
    timeout_milliseconds:=30000
  ) into v_request_id;
  return v_request_id;
end;
$function$;

do $migration$
begin
  if exists(select 1 from cron.job where jobname='relationship-google-hourly-reconciliation') then
    perform cron.unschedule('relationship-google-hourly-reconciliation');
  end if;
  if exists(select 1 from cron.job where jobname='relationship-google-daily-watch-renewal') then
    perform cron.unschedule('relationship-google-daily-watch-renewal');
  end if;
  perform cron.schedule('relationship-google-hourly-reconciliation','17 * * * *',
    'select private.run_relationship_google_maintenance();');
  perform cron.schedule('relationship-google-daily-watch-renewal','23 8 * * *',
    'select private.run_relationship_google_maintenance();');
end
$migration$;

revoke all on function private.relationship_flag_enabled(uuid,text),
  private.open_relationship_reconciliation_issue(uuid,text,text,text,text,uuid,uuid,jsonb,text),
  private.transition_relationship_opportunity_from_activity(uuid,text,uuid,text,timestamptz,uuid),
  private.auto_enroll_bty_opportunity(uuid,uuid),
  private.apply_relationship_activity(uuid,text,text,text,text,uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,jsonb,uuid),
  private.capture_bty_ready_for_campaign(),private.guard_bty_followup_activation(),
  private.relationship_orchestration_context(boolean),
  private.resolve_relationship_gmail_message(uuid,text,text,jsonb,text,text[],text),
  private.run_relationship_google_maintenance()
  from public,anon,authenticated;
revoke all on function private.record_relationship_delivery_result(uuid,uuid,text,text,text,text,timestamptz,text,text),
  private.ingest_relationship_inbound_reply(text,text,text,text,uuid,text,text,text,text,text,timestamptz,jsonb)
  from public,anon,authenticated;
grant execute on function private.record_relationship_delivery_result(uuid,uuid,text,text,text,text,timestamptz,text,text),
  private.ingest_relationship_inbound_reply(text,text,text,text,uuid,text,text,text,text,text,timestamptz,jsonb)
  to service_role;

revoke all on function public.apply_relationship_activity(uuid,text,text,text,text,uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,jsonb),
  public.create_relationship_google_oauth_state(uuid,text,uuid,text,text,text,timestamptz),
  public.consume_relationship_google_oauth_state(text),
  public.store_relationship_google_connection(uuid,text,text,text,text,text[],text,uuid),
  public.get_relationship_google_connection_runtime(uuid,text,uuid),
  public.get_relationship_observation_flags(uuid),
  public.get_relationship_google_sync_state(uuid),
  public.update_relationship_google_sync_state(uuid,text,timestamptz,text,boolean,boolean,boolean,text,text),
  public.get_relationship_calendar_channel(uuid),public.validate_relationship_calendar_channel(uuid,text,text),
  public.store_relationship_calendar_channel(uuid,uuid,text,text,timestamptz),
  public.match_relationship_gmail_message(uuid,text,text,jsonb,text,text[],text),
  public.ingest_relationship_gmail_message(uuid,text,text,jsonb,text,text[],text,text,timestamptz,text[]),
  public.ingest_relationship_calendar_event(uuid,uuid,text,text,text,text,timestamptz,timestamptz,text[],text,text,timestamptz,jsonb)
  from public,anon,authenticated;
grant execute on function public.apply_relationship_activity(uuid,text,text,text,text,uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,jsonb),
  public.create_relationship_google_oauth_state(uuid,text,uuid,text,text,text,timestamptz),
  public.consume_relationship_google_oauth_state(text),
  public.store_relationship_google_connection(uuid,text,text,text,text,text[],text,uuid),
  public.get_relationship_google_connection_runtime(uuid,text,uuid),
  public.get_relationship_observation_flags(uuid),
  public.get_relationship_google_sync_state(uuid),
  public.update_relationship_google_sync_state(uuid,text,timestamptz,text,boolean,boolean,boolean,text,text),
  public.get_relationship_calendar_channel(uuid),public.validate_relationship_calendar_channel(uuid,text,text),
  public.store_relationship_calendar_channel(uuid,uuid,text,text,timestamptz),
  public.match_relationship_gmail_message(uuid,text,text,jsonb,text,text[],text),
  public.ingest_relationship_gmail_message(uuid,text,text,jsonb,text,text[],text,text,timestamptz,text[]),
  public.ingest_relationship_calendar_event(uuid,uuid,text,text,text,text,timestamptz,timestamptz,text[],text,text,timestamptz,jsonb)
  to service_role;

revoke all on function public.record_relationship_operator_activity(uuid,text,text,jsonb),
  public.retry_relationship_bty_auto_enrollment(uuid,text),
  public.resolve_relationship_reconciliation_issue(uuid,text,text),
  public.get_relationship_opportunity_orchestration(uuid),
  public.list_relationship_orchestration_integrity(),
  public.preview_relationship_bty_reconciliation(),
  public.apply_relationship_bty_reconciliation(uuid,jsonb)
  from public,anon;
grant execute on function public.record_relationship_operator_activity(uuid,text,text,jsonb),
  public.retry_relationship_bty_auto_enrollment(uuid,text),
  public.resolve_relationship_reconciliation_issue(uuid,text,text),
  public.get_relationship_opportunity_orchestration(uuid),
  public.list_relationship_orchestration_integrity(),
  public.preview_relationship_bty_reconciliation(),
  public.apply_relationship_bty_reconciliation(uuid,jsonb)
  to authenticated,service_role;

revoke all on function public.record_relationship_delivery_result(uuid,uuid,text,text,text,text,timestamptz,text,text),
  public.ingest_relationship_inbound_reply(text,text,text,text,uuid,text,text,text,text,text,timestamptz,jsonb)
  from public,anon,authenticated;
grant execute on function public.record_relationship_delivery_result(uuid,uuid,text,text,text,text,timestamptz,text,text),
  public.ingest_relationship_inbound_reply(text,text,text,text,uuid,text,text,text,text,text,timestamptz,jsonb)
  to service_role;

comment on function private.apply_relationship_activity(uuid,text,text,text,text,uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,jsonb,uuid)
  is 'Single BTY evidence application engine. Lock order: activity, opportunity, enrollment, work, communication/reply.';

