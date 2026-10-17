-- Preserve CRM authorization: stage review work without bypassing the existing
-- auth.uid()-based relationship task subject trigger.
create or replace function private.refresh_relationship_email_review_queue(
 p_tenant_id uuid default '00000000-0000-0000-0000-000000000001'::uuid,
 p_owner_id uuid default 'd2dc0624-1e71-49d6-8b04-76cf1e822074'::uuid
) returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare
 g record;
 v_task uuid;
 v_issues integer;
 v_tasks_created integer:=0;
 v_organizations integer;
 v_queued integer;
begin
 if p_tenant_id <> '00000000-0000-0000-0000-000000000001'::uuid then
   raise exception 'Unrecognized ValorWell tenant.';
 end if;
 if not exists (select 1 from public.profiles where id=p_owner_id and is_active=true) then
   raise exception 'Review-task owner is not an active CRM profile.';
 end if;
 perform pg_advisory_xact_lock(hashtext('relationship_email_triage:'||p_tenant_id::text));
 with issues as (
  select i.id,i.tenant_id,i.source,i.external_event_id,i.details,
         nullif(lower(btrim(i.details->>'from_email')),'') as sender
  from public.relationship_reconciliation_issues i
  where i.tenant_id=p_tenant_id and i.status='open'
    and i.issue_type='ambiguous_email_thread' and i.source in ('gmail','resend')
 ),
 cc as (
  select i.id issue_id,count(c.id) n,min(c.id::text)::uuid cid
  from issues i left join public.relationship_contacts c
   on c.tenant_id=i.tenant_id and lower(c.email)=i.sender
    and i.sender<>'info@valorwell.org'
  group by i.id
 ),
 oc as (
  select i.id issue_id,count(distinct co.organization_id) n,
         min(co.organization_id::text)::uuid oid
  from issues i join cc on cc.issue_id=i.id
  left join public.relationship_contact_organizations co
    on co.tenant_id=i.tenant_id and co.contact_id=cc.cid and cc.n=1
  group by i.id
 ),
 op as (
  select i.id issue_id,count(distinct p.id) n,min(p.id::text)::uuid oid
  from issues i join cc on cc.issue_id=i.id join oc on oc.issue_id=i.id
  left join public.relationship_opportunities p
    on p.tenant_id=i.tenant_id and p.primary_contact_id=cc.cid
   and p.organization_id=oc.oid and cc.n=1 and oc.n=1
  group by i.id
 ),
 obs as (
  select i.id issue_id,count(distinct o.communication_id) n,
    min(cm.id::text)::uuid cid,
    min(cm.contact_id::text)::uuid contact_id,
    min(cm.organization_id::text)::uuid organization_id,
    min(cm.opportunity_id::text)::uuid opportunity_id
  from issues i
  join public.relationship_message_observations o
    on o.tenant_id=i.tenant_id and o.source=i.source
   and o.provider_message_id=i.external_event_id
  join public.relationship_communications cm on cm.id=o.communication_id and cm.tenant_id=i.tenant_id
  group by i.id
 ),
 basis as (
  select i.*,
    case when coalesce(obs.n,0)=1 and obs.organization_id is not null
         then 'existing_communication_needs_opportunity_review'
         when cc.n=1 and oc.n=1 and op.n=1 then 'unique_sender_opportunity_candidate'
         when cc.n=1 and oc.n=1 then 'unique_sender_organization_candidate'
         when cc.n=1 then 'unique_sender_contact_only'
         when i.sender='info@valorwell.org' then 'outbound_without_unique_anchor'
         when i.sender is null then 'legacy_without_sender_metadata'
         else 'unknown_sender_needs_review' end classification,
    case when coalesce(obs.n,0)=1 and obs.organization_id is not null
         then obs.organization_id
         when cc.n=1 and oc.n=1 then oc.oid else null end organization_id,
    case when coalesce(obs.n,0)=1 and obs.contact_id is not null
         then obs.contact_id
         when cc.n=1 then cc.cid else null end contact_id,
    case when coalesce(obs.n,0)=1 and obs.opportunity_id is not null
         then obs.opportunity_id
         when cc.n=1 and oc.n=1 and op.n=1
           and (obs.organization_id is null or obs.organization_id=oc.oid)
         then op.oid else null end opportunity_id,
    case when coalesce(obs.n,0)=1 then obs.cid else null end communication_id,
    cc.n contact_matches,oc.n organization_matches,op.n opportunity_matches,
    coalesce(obs.n,0) observed_matches
  from issues i
  join cc on cc.issue_id=i.id
  join oc on oc.issue_id=i.id
  join op on op.issue_id=i.id
  left join obs on obs.issue_id=i.id
 ),
 labeled as (
  select b.*,case when organization_id is not null then 'org:'||organization_id::text
        else 'queue:'||classification end group_key
  from basis b
 )
 insert into private.relationship_email_issue_triage(
  issue_id,tenant_id,source,classification,candidate_contact_id,candidate_organization_id,
  candidate_opportunity_id,observed_communication_id,group_key,evidence)
 select id,tenant_id,source,classification,contact_id,organization_id,
        opportunity_id,communication_id,group_key,
        jsonb_build_object('sender_matches',contact_matches,
          'org_matches',organization_matches,'opportunity_matches',opportunity_matches,
          'observed_communication_matches',observed_matches,
          'provider_message_id',external_event_id,
          'source_issue_id',id,'matched_using','stored_exact_email_and_existing_crm_links')
 from labeled
 on conflict(issue_id) do update set
   source=excluded.source,classification=excluded.classification,
   candidate_contact_id=excluded.candidate_contact_id,
   candidate_organization_id=excluded.candidate_organization_id,
   candidate_opportunity_id=excluded.candidate_opportunity_id,
   observed_communication_id=excluded.observed_communication_id,
   group_key=excluded.group_key,evidence=excluded.evidence,updated_at=now()
 where private.relationship_email_issue_triage.review_state='needs_review';

 select count(*) into v_issues
 from private.relationship_email_issue_triage t
 join public.relationship_reconciliation_issues i on i.id=t.issue_id
 where t.tenant_id=p_tenant_id and i.status='open';

 for g in
  select t.group_key,min(t.candidate_organization_id::text)::uuid organization_id,
         count(*) as issues,min(org.name) org_name
  from private.relationship_email_issue_triage t
  join public.relationship_reconciliation_issues i on i.id=t.issue_id and i.status='open'
  left join public.relationship_organizations org on org.id=t.candidate_organization_id
  where t.tenant_id=p_tenant_id and t.review_state='needs_review'
  group by t.group_key
  order by t.group_key
 loop
  insert into private.relationship_email_review_groups(tenant_id,group_key,organization_id,issue_count)
  values(p_tenant_id,g.group_key,g.organization_id,g.issues)
  on conflict(tenant_id,group_key) do update
    set issue_count=excluded.issue_count,updated_at=now();
  select task_id into v_task from private.relationship_email_review_groups
  where tenant_id=p_tenant_id and group_key=g.group_key for update;
  -- Existing crm_tasks policy requires auth.uid() and edit_relationships.
  -- Never create linked CRM tasks from a service-role reconciliation worker.
  -- Review groups remain staged until an authenticated CRM operator creates
  -- or links review tasks through the ordinary task repository.

  update private.relationship_email_issue_triage t
    set review_task_id=v_task,updated_at=now()
  where t.tenant_id=p_tenant_id and t.group_key=g.group_key
    and t.review_state='needs_review';
 end loop;
 select count(*) into v_organizations
 from private.relationship_email_review_groups where tenant_id=p_tenant_id and organization_id is not null;
 select count(*) into v_queued
 from private.relationship_email_review_groups where tenant_id=p_tenant_id and organization_id is null;
 return jsonb_build_object('openIssuesStaged',v_issues,'tasksCreated',v_tasks_created,
   'organizationReviewGroups',v_organizations,'generalReviewGroups',v_queued);
end;
$fn$;
