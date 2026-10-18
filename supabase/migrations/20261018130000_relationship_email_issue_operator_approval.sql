-- Explicit operator-authorized decision for one non-clinical email association.
-- No inferred stage transition, sending, meeting or task side effect.
create or replace function public.approve_relationship_email_issue(
  p_issue_id uuid, p_opportunity_id uuid
) returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare
 v_ctx jsonb:=private.relationship_orchestration_context(true);
 v_tenant uuid:=(v_ctx->>'tenant_id')::uuid;
 v_actor uuid:=(v_ctx->>'actor_id')::uuid;
 v_issue public.relationship_reconciliation_issues%rowtype;
 v_triage private.relationship_email_issue_triage%rowtype;
begin
 select * into v_issue from public.relationship_reconciliation_issues
 where tenant_id=v_tenant and id=p_issue_id and status='open'
   and issue_type='ambiguous_email_thread' and source in ('gmail','resend')
 for update;
 if not found then raise exception 'Open email review issue not found.' using errcode='P0002'; end if;
 select * into v_triage from private.relationship_email_issue_triage
 where tenant_id=v_tenant and issue_id=p_issue_id and review_state='needs_review'
 for update;
 if not found or v_triage.candidate_opportunity_id is distinct from p_opportunity_id
   or v_triage.candidate_contact_id is null
   or v_triage.candidate_organization_id is null
   or v_triage.classification <> 'unique_sender_opportunity_candidate'
 then raise exception 'Issue is not eligible for exact-source association approval.' using errcode='42501';
 end if;
 if not exists(
   select 1 from public.relationship_opportunities o
   where o.tenant_id=v_tenant and o.id=p_opportunity_id
     and o.organization_id=v_triage.candidate_organization_id
     and o.primary_contact_id=v_triage.candidate_contact_id
 ) then raise exception 'Candidate CRM opportunity is no longer consistent.' using errcode='23514';
 end if;
 update public.relationship_reconciliation_issues
 set status='resolved',resolved_at=now(),resolved_by_profile_id=v_actor,
     opportunity_id=p_opportunity_id,
     resolution='Operator confirmed exact email sender and sole compatible opportunity. Evidence staged in CRM triage; no stage transition or outbound email.',
     updated_at=now()
 where id=p_issue_id and tenant_id=v_tenant;
 update private.relationship_email_issue_triage
 set review_state='approved',updated_at=now()
 where issue_id=p_issue_id and tenant_id=v_tenant;
 return jsonb_build_object('issueId',p_issue_id,'approvedOpportunityId',p_opportunity_id,'status','resolved');
end;
$fn$;
revoke all on function public.approve_relationship_email_issue(uuid,uuid) from public,anon;
grant execute on function public.approve_relationship_email_issue(uuid,uuid) to authenticated;
