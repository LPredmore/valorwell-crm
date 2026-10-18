-- Repair only already-captured BTY communications with structurally unique CRM links.
-- No outbound sending, inferred workflow stages, or global mutation flags.
create table if not exists private.relationship_email_structural_link_audit (
 issue_id uuid primary key references public.relationship_reconciliation_issues(id),
 tenant_id uuid not null references public.tenants(id),
 communication_id uuid not null references public.relationship_communications(id),
 opportunity_id uuid not null references public.relationship_opportunities(id),
 previous_opportunity_id uuid,
 replies_linked integer not null default 0,
 evidence jsonb not null default '{}'::jsonb,
 applied_at timestamptz not null default now()
);
alter table private.relationship_email_structural_link_audit enable row level security;
revoke all on private.relationship_email_structural_link_audit from public,anon,authenticated;
grant select,insert on private.relationship_email_structural_link_audit to service_role;

create or replace function private.reconcile_anchored_relationship_email_links(
 p_apply boolean default false,
 p_limit integer default 100
) returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare
 v record;
 v_eligible integer:=0;
 v_applied integer:=0;
 v_replies integer:=0;
 v_rows integer;
 v_already integer:=0;
begin
 if p_limit not between 1 and 100 then
   raise exception 'Reconciliation batch must be 1–100.' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(hashtext('relationship_email_anchor_repair_v1'));
 if not p_apply then
   select count(*) into v_eligible from (
     select t.issue_id
     from private.relationship_email_issue_triage t
     join public.relationship_reconciliation_issues i on i.id=t.issue_id and i.status='open'
     join public.relationship_communications cm on cm.id=t.observed_communication_id and cm.tenant_id=t.tenant_id
     join public.relationship_contacts c on c.id=cm.contact_id and c.tenant_id=cm.tenant_id
     where t.tenant_id='00000000-0000-0000-0000-000000000001'::uuid
       and t.review_state='needs_review' and t.source='gmail'
       and t.classification='existing_communication_needs_opportunity_review'
       and cm.opportunity_id is null and cm.organization_id is not null
       and cm.subject ~* '(beyond the yellow|(^|[^a-z])bty([^a-z]|$)|nominat|recommend)'
       and ((cm.direction='inbound' and lower(cm.sender_email)=lower(c.email))
          or (cm.direction='outbound' and lower(cm.recipient_email)=lower(c.email)))
       and (select count(*) from public.relationship_opportunities op
          where op.tenant_id=cm.tenant_id and op.organization_id=cm.organization_id
           and (op.primary_contact_id=cm.contact_id or op.primary_contact_id is null))=1
   ) q;
   return jsonb_build_object('dryRun',true,'eligible',v_eligible,'applied',0);
 end if;
 for v in
   select i.id issue_id,t.tenant_id,cm.id comm_id,cm.organization_id,cm.contact_id,
      cm.opportunity_id previous_opportunity_id,
      (select min(op.id::text)::uuid from public.relationship_opportunities op
       where op.tenant_id=cm.tenant_id and op.organization_id=cm.organization_id
         and (op.primary_contact_id=cm.contact_id or op.primary_contact_id is null)) new_opportunity_id
   from private.relationship_email_issue_triage t
   join public.relationship_reconciliation_issues i on i.id=t.issue_id and i.status='open'
   join public.relationship_communications cm on cm.id=t.observed_communication_id and cm.tenant_id=t.tenant_id
   join public.relationship_contacts c on c.id=cm.contact_id and c.tenant_id=cm.tenant_id
   where t.tenant_id='00000000-0000-0000-0000-000000000001'::uuid
     and t.review_state='needs_review' and t.source='gmail'
     and t.classification='existing_communication_needs_opportunity_review'
     and cm.opportunity_id is null and cm.organization_id is not null
     and cm.subject ~* '(beyond the yellow|(^|[^a-z])bty([^a-z]|$)|nominat|recommend)'
     and ((cm.direction='inbound' and lower(cm.sender_email)=lower(c.email))
       or (cm.direction='outbound' and lower(cm.recipient_email)=lower(c.email)))
     and (select count(*) from public.relationship_opportunities op
       where op.tenant_id=cm.tenant_id and op.organization_id=cm.organization_id
        and (op.primary_contact_id=cm.contact_id or op.primary_contact_id is null))=1
   order by i.created_at,i.id
   limit p_limit for update of i,t,cm skip locked
 loop
   if exists(select 1 from private.relationship_email_structural_link_audit a where a.issue_id=v.issue_id) then
     v_already:=v_already+1;
     continue;
   end if;
   update public.relationship_communications
     set opportunity_id=v.new_opportunity_id
   where id=v.comm_id and tenant_id=v.tenant_id and opportunity_id is null
     and contact_id=v.contact_id and organization_id=v.organization_id;
   get diagnostics v_rows=row_count;
   if v_rows<>1 then raise exception 'Concurrent communication association changed for issue %',v.issue_id;end if;
   update public.relationship_replies
     set opportunity_id=v.new_opportunity_id
   where tenant_id=v.tenant_id and communication_id=v.comm_id
     and opportunity_id is null and contact_id=v.contact_id
     and organization_id=v.organization_id;
   get diagnostics v_rows=row_count;
   v_replies:=v_replies+v_rows;
   insert into private.relationship_email_structural_link_audit(
     issue_id,tenant_id,communication_id,opportunity_id,
     previous_opportunity_id,replies_linked,evidence
   ) values (
     v.issue_id,v.tenant_id,v.comm_id,v.new_opportunity_id,
     v.previous_opportunity_id,v_rows,
     jsonb_build_object('rule','sole_org_contact_opportunity_with_stored_message_and_bty_subject',
       'source','gmail','no_stage_mutation',true,'no_outbound_action',true)
   );
   update public.relationship_reconciliation_issues
     set status='resolved',resolved_at=now(),
       resolution='Reconciled existing BTY communication and reply to the sole compatible CRM opportunity; no stage transition or outbound action.',
       opportunity_id=v.new_opportunity_id,updated_at=now()
   where tenant_id=v.tenant_id and id=v.issue_id and status='open';
   update private.relationship_email_issue_triage
     set review_state='approved',candidate_opportunity_id=v.new_opportunity_id,updated_at=now()
   where tenant_id=v.tenant_id and issue_id=v.issue_id;
   v_applied:=v_applied+1;
 end loop;
 return jsonb_build_object('dryRun',false,'communicationsLinked',v_applied,
   'repliesLinked',v_replies,'previouslyAudited',v_already);
end;
$fn$;
revoke all on function private.reconcile_anchored_relationship_email_links(boolean,integer) from public,anon,authenticated;
grant execute on function private.reconcile_anchored_relationship_email_links(boolean,integer) to service_role;
