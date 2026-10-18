-- Capture a BTY inbox reply without an outbound anchor ONLY when sender,
-- relationship contact, organization and primary-contact opportunity are unique.
-- The exact recipient and BTY subject must match. No send, stage or campaign mutations.
create or replace function private.find_exact_bty_inbound_candidate(
 p_tenant uuid,p_sender text,p_recipients text[],p_subject text
) returns jsonb language plpgsql stable security definer set search_path=''
as $fn$
declare
 v_contact uuid;
 v_organization uuid;
 v_opportunity uuid;
 v_count integer;
begin
 if lower(btrim(coalesce(p_sender,'')))='info@valorwell.org'
  or not exists(select 1 from unnest(coalesce(p_recipients,'{}'::text[])) x
    where lower(btrim(x))='info@valorwell.org')
  or coalesce(p_subject,'') !~* '(beyond the yellow|(^|[^a-z])bty([^a-z]|$))' then
   return jsonb_build_object('safe',false);
 end if;
 select count(*),min(id::text)::uuid into v_count,v_contact
 from public.relationship_contacts
 where tenant_id=p_tenant and lower(email)=lower(btrim(p_sender));
 if v_count<>1 then return jsonb_build_object('safe',false); end if;
 select count(distinct organization_id),min(organization_id::text)::uuid
 into v_count,v_organization
 from public.relationship_contact_organizations
 where tenant_id=p_tenant and contact_id=v_contact;
 if v_count<>1 then return jsonb_build_object('safe',false); end if;
 select count(*),min(id::text)::uuid into v_count,v_opportunity
 from public.relationship_opportunities
 where tenant_id=p_tenant and organization_id=v_organization
   and primary_contact_id=v_contact;
 if v_count<>1 then return jsonb_build_object('safe',false); end if;
 return jsonb_build_object('safe',true,'contactId',v_contact,
   'organizationId',v_organization,'opportunityId',v_opportunity);
end;
$fn$;
revoke all on function private.find_exact_bty_inbound_candidate(uuid,text,text[],text) from public,anon,authenticated;
grant execute on function private.find_exact_bty_inbound_candidate(uuid,text,text[],text) to service_role;

create table if not exists private.relationship_email_unanchored_intake_audit (
 tenant_id uuid not null references public.tenants(id),
 provider_message_id text not null,
 communication_id uuid not null references public.relationship_communications(id),
 contact_id uuid not null references public.relationship_contacts(id),
 organization_id uuid not null references public.relationship_organizations(id),
 opportunity_id uuid not null references public.relationship_opportunities(id),
 classification text not null,
 rule text not null,
 recorded_at timestamptz not null default now(),
 primary key(tenant_id,provider_message_id)
);
alter table private.relationship_email_unanchored_intake_audit enable row level security;
revoke all on private.relationship_email_unanchored_intake_audit from public,anon,authenticated;
grant select,insert on private.relationship_email_unanchored_intake_audit to service_role;

create or replace function public.match_relationship_gmail_message(
 p_tenant_id uuid,p_gmail_message_id text,p_gmail_thread_id text,
 p_headers jsonb,p_from_email text,p_to_emails text[],p_subject text
) returns jsonb language plpgsql stable security definer set search_path=''
as $fn$
declare
 v_match jsonb;
 v_candidate jsonb;
 v_anchored boolean;
 v_safe boolean;
begin
 if not private.relationship_flag_enabled(p_tenant_id,'relationship_gmail_observation_enabled') then
  return jsonb_build_object('matched',false,'observationEnabled',false,'shouldFetchFull',false);
 end if;
 v_match:=private.resolve_relationship_gmail_message(
   p_tenant_id,p_gmail_message_id,p_gmail_thread_id,p_headers,p_from_email,p_to_emails,p_subject);
 v_anchored:=coalesce((v_match->>'matched')::boolean,false);
 v_candidate:=case when v_anchored then '{}'::jsonb
   else private.find_exact_bty_inbound_candidate(p_tenant_id,p_from_email,p_to_emails,p_subject) end;
 v_safe:=coalesce((v_candidate->>'safe')::boolean,false);
 return v_match || jsonb_build_object('observationEnabled',true,
   'shouldFetchFull',v_anchored or v_safe,'unanchoredCandidate',v_safe);
end;
$fn$;
revoke all on function public.match_relationship_gmail_message(uuid,text,text,jsonb,text,text[],text) from public,anon,authenticated;
grant execute on function public.match_relationship_gmail_message(uuid,text,text,jsonb,text,text[],text) to service_role;

-- Service-role-only history replay: return only existing, unresolved exact
-- sender/opportunity candidates, never arbitrary mailbox message IDs.
create or replace function public.list_pending_exact_bty_gmail_message_ids(
 p_limit integer default 6
) returns jsonb language plpgsql stable security definer set search_path=''
as $fn$
declare v_result jsonb;
begin
 if p_limit not between 1 and 20 then raise exception 'Invalid Gmail replay limit.';end if;
 select coalesce(jsonb_agg(x.external_event_id),'[]'::jsonb)
 into v_result from (
  select i.external_event_id from public.relationship_reconciliation_issues i
  join private.relationship_email_issue_triage t on t.issue_id=i.id
  where i.tenant_id='00000000-0000-0000-0000-000000000001'::uuid
    and i.source='gmail' and i.status='open'
    and i.issue_type='ambiguous_email_thread'
    and t.classification='unique_sender_opportunity_candidate'
    and t.review_state='needs_review'
    and coalesce(i.details->>'subject','') ~*
      '(beyond the yellow|(^|[^a-z])bty([^a-z]|$))'
    and i.external_event_id is not null
  order by i.created_at asc,i.id
  limit p_limit
 ) x;
 return v_result;
end;
$fn$;
revoke all on function public.list_pending_exact_bty_gmail_message_ids(integer) from public,anon,authenticated;
grant execute on function public.list_pending_exact_bty_gmail_message_ids(integer) to service_role;
