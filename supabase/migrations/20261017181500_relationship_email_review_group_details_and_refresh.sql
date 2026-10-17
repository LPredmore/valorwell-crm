-- Keep non-clinical review evidence current while Gmail/Resend continue to ingest.
-- This refresh only stages candidates and never creates linked CRM tasks,
-- changes opportunity statuses or sends email.
select cron.schedule(
  'relationship-email-evidence-hourly-refresh',
  '41 * * * *',
  'select private.refresh_relationship_email_review_queue();'
);

-- Read-only issue details for a single CRM review group.
-- Authorize through the existing CRM operating context. Never return bodies.
create or replace function public.list_relationship_email_review_group_issues(
 p_group_key text,
 p_limit integer default 75
) returns jsonb
language plpgsql stable security definer set search_path=''
as $fn$
declare
 v_context jsonb:=private.relationship_orchestration_context(false);
 v_tenant uuid:=(v_context->>'tenant_id')::uuid;
 v_rows jsonb;
begin
 if p_group_key is null or length(p_group_key)>180 or p_limit not between 1 and 100 then
   raise exception 'Invalid email review group request.' using errcode='22023';
 end if;
 if not exists (select 1 from private.relationship_email_review_groups
                where tenant_id=v_tenant and group_key=p_group_key) then
   raise exception 'Email review group not found.' using errcode='P0002';
 end if;
 select coalesce(jsonb_agg(jsonb_build_object(
    'issueId',x.issue_id,'source',x.source,'classification',x.classification,
    'sender',x.sender,'subject',x.subject,
    'candidateContactId',x.candidate_contact_id,
    'candidateOpportunityId',x.candidate_opportunity_id,
    'existingCommunicationId',x.observed_communication_id,
    'issueCreatedAt',x.created_at,
    'providerMessageId',x.external_event_id
 ) order by x.created_at desc),'[]'::jsonb)
 into v_rows from (
    select t.issue_id,t.source,t.classification,
      left(coalesce(i.details->>'from_email',''),180) sender,
      left(coalesce(i.details->>'subject',''),240) subject,
      t.candidate_contact_id,t.candidate_opportunity_id,
      t.observed_communication_id,i.created_at,i.external_event_id
    from private.relationship_email_issue_triage t
    join public.relationship_reconciliation_issues i on i.id=t.issue_id
    where t.tenant_id=v_tenant and t.group_key=p_group_key
      and t.review_state='needs_review' and i.status='open'
    order by i.created_at desc limit p_limit
 ) x;
 return v_rows;
end;
$fn$;
revoke all on function public.list_relationship_email_review_group_issues(text,integer) from public,anon;
grant execute on function public.list_relationship_email_review_group_issues(text,integer) to authenticated;
