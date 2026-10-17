-- Expose only non-clinical reconciliation summaries to authenticated CRM members.
-- Private candidate evidence remains service-role-only.
create or replace function public.list_relationship_email_review_queue(
 p_limit integer default 100
) returns jsonb
language plpgsql stable security definer set search_path=''
as $fn$
declare
 v_context jsonb:=private.relationship_orchestration_context(false);
 v_tenant uuid:=(v_context->>'tenant_id')::uuid;
 v_groups jsonb;
 v_counts jsonb;
begin
 if p_limit not between 1 and 200 then
   raise exception 'Invalid review queue limit.' using errcode='22023';
 end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'groupKey',q.group_key,
  'organizationId',q.organization_id,
  'organizationName',q.org_name,
  'issueCount',q.issue_count,
  'reviewTaskId',q.task_id,
  'candidateOpportunityCount',q.candidate_opportunities,
  'sourceSummary',q.sources,
  'classifications',q.classifications
 ) order by q.issue_count desc,q.group_key),'[]'::jsonb)
 into v_groups from (
  select g.group_key,g.organization_id,org.name org_name,g.task_id,
     count(t.issue_id) issue_count,
     count(distinct t.candidate_opportunity_id) candidate_opportunities,
     jsonb_object_agg(distinct t.source, 1) sources,
     array_agg(distinct t.classification order by t.classification) classifications
  from private.relationship_email_review_groups g
  join private.relationship_email_issue_triage t on t.tenant_id=g.tenant_id and t.group_key=g.group_key
    and t.review_state='needs_review'
  join public.relationship_reconciliation_issues i on i.id=t.issue_id and i.status='open'
  left join public.relationship_organizations org on org.tenant_id=g.tenant_id and org.id=g.organization_id
  where g.tenant_id=v_tenant
  group by g.group_key,g.organization_id,org.name,g.task_id
  order by count(t.issue_id) desc,g.group_key
  limit p_limit
 ) q;
 select jsonb_build_object(
  'openIssues',count(*),
  'candidateOpportunities',count(*) filter(where candidate_opportunity_id is not null),
  'existingCommunications',count(*) filter(where observed_communication_id is not null),
  'awaitingReview',count(*) filter(where review_state='needs_review')
 ) into v_counts
 from private.relationship_email_issue_triage t
 join public.relationship_reconciliation_issues i on i.id=t.issue_id
 where t.tenant_id=v_tenant and i.status='open';
 return jsonb_build_object('summary',coalesce(v_counts,'{}'::jsonb),'groups',v_groups);
end;
$fn$;

create or replace function public.link_relationship_email_review_task(
 p_group_key text,
 p_task_id uuid
) returns jsonb
language plpgsql security definer set search_path=''
as $fn$
declare
 v_context jsonb:=private.relationship_orchestration_context(true);
 v_tenant uuid:=(v_context->>'tenant_id')::uuid;
 v_actor uuid:=(v_context->>'actor_id')::uuid;
 v_group private.relationship_email_review_groups%rowtype;
 v_task public.crm_tasks%rowtype;
begin
 if p_group_key is null or length(p_group_key)>180 then
   raise exception 'Invalid email review group.' using errcode='22023';
 end if;
 select * into v_group from private.relationship_email_review_groups
 where tenant_id=v_tenant and group_key=p_group_key for update;
 if not found then raise exception 'Email review group not found.' using errcode='P0002'; end if;
 select * into v_task from public.crm_tasks where id=p_task_id and tenant_id=v_tenant;
 if not found then raise exception 'CRM review task does not exist.' using errcode='P0002'; end if;
 if v_task.created_by_profile_id<>v_actor
   or v_task.relationship_organization_id is distinct from v_group.organization_id
   or v_task.client_id is not null or v_task.staff_id is not null
   or v_task.campaign_id is not null or v_task.exception_id is not null then
   raise exception 'Review task must be created by the current operator for the same non-clinical organization.' using errcode='42501';
 end if;
 if v_group.task_id is not null and v_group.task_id<>p_task_id then
   raise exception 'The review group already has a different task.' using errcode='23505';
 end if;
 update private.relationship_email_review_groups set task_id=p_task_id,updated_at=now()
 where tenant_id=v_tenant and group_key=p_group_key;
 update private.relationship_email_issue_triage set review_task_id=p_task_id,updated_at=now()
 where tenant_id=v_tenant and group_key=p_group_key and review_state='needs_review';
 return jsonb_build_object('groupKey',p_group_key,'taskId',p_task_id);
end;
$fn$;
revoke all on function public.list_relationship_email_review_queue(integer) from public,anon;
revoke all on function public.link_relationship_email_review_task(text,uuid) from public,anon;
grant execute on function public.list_relationship_email_review_queue(integer) to authenticated;
grant execute on function public.link_relationship_email_review_task(text,uuid) to authenticated;
