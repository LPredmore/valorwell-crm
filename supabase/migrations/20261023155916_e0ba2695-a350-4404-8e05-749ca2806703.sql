-- Receipts are written only by trusted server-side Gmail retrieval, never by
-- an operator's association approval or by copying historical CRM metadata.
create table private.relationship_gmail_source_receipts (
 tenant_id uuid not null references public.tenants(id),
 provider_message_id text not null check(length(provider_message_id)>0),
 provider_thread_id text not null check(length(provider_thread_id)>0),
 mailbox text not null check(mailbox='info@valorwell.org'),
 headers jsonb not null,
 label_ids jsonb not null,
 retrieved_at timestamptz not null default now(),
 provenance text not null default 'gmail.messages.get/full' check(provenance='gmail.messages.get/full'),
 primary key(tenant_id,provider_message_id)
);
alter table private.relationship_gmail_source_receipts enable row level security;
revoke all on private.relationship_gmail_source_receipts from public,anon,authenticated;
grant select,insert,update on private.relationship_gmail_source_receipts to service_role;

create or replace function public.record_relationship_gmail_source_receipt(
 p_tenant_id uuid,p_message_id text,p_thread_id text,p_mailbox text,p_headers jsonb,p_label_ids jsonb
) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_tenant_id <> '00000000-0000-0000-0000-000000000001'::uuid
   or p_mailbox is distinct from 'info@valorwell.org'
   or jsonb_typeof(p_headers) is distinct from 'object'
   or jsonb_typeof(p_label_ids) is distinct from 'array'
   or p_label_ids ? 'DRAFT' then
   raise exception 'Invalid authoritative Gmail receipt.' using errcode='22023';
 end if;
 insert into private.relationship_gmail_source_receipts
   (tenant_id,provider_message_id,provider_thread_id,mailbox,headers,label_ids)
 values(p_tenant_id,p_message_id,p_thread_id,p_mailbox,p_headers,p_label_ids)
 on conflict(tenant_id,provider_message_id) do update set
   headers=excluded.headers,label_ids=excluded.label_ids,retrieved_at=now()
 where relationship_gmail_source_receipts.provider_thread_id=excluded.provider_thread_id;
 if not found then raise exception 'Conflicting Gmail identity.'; end if;
end;
$$;
revoke all on function public.record_relationship_gmail_source_receipt(uuid,text,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.record_relationship_gmail_source_receipt(uuid,text,text,text,jsonb,jsonb) to service_role;

create or replace function private.relationship_has_exact_gmail_source(
 p_tenant uuid,p_claimed_id text,p_communication uuid
) returns boolean language sql stable security definer set search_path='' as $$
 select exists(
   select 1 from public.relationship_communications cm
   join private.relationship_gmail_source_receipts r
     on r.tenant_id=cm.tenant_id and r.provider_message_id=cm.provider_message_id
   where cm.tenant_id=p_tenant and cm.id=p_communication and cm.provider='gmail'
     and r.provider_message_id=p_claimed_id
     and r.provider_thread_id=cm.provider_thread_id
     and not (r.label_ids ? 'DRAFT')
     and (cm.direction='inbound' or (cm.direction='outbound' and r.label_ids ? 'SENT'))
     and lower(btrim(regexp_replace(r.headers->>'from','^.*<([^>]+)>.*$','\1')))=lower(cm.sender_email)
     and (cm.direction='inbound' or exists(select 1 from regexp_split_to_table(lower(r.headers->>'to'),'[,<>[:space:]]+') email where email=lower(cm.recipient_email)))
     -- Existing conflicting RFC identity requires review, even with an exact ID.
     and (nullif(cm.metadata->>'rfc_message_id','') is null
       or cm.metadata->>'rfc_message_id'=r.headers->>'message-id')
     and not exists(select 1 from public.relationship_message_observations o
       where o.tenant_id=cm.tenant_id and o.communication_id=cm.id
       and nullif(o.rfc_message_id,'') is not null
       and o.rfc_message_id is distinct from r.headers->>'message-id')
 );
$$;
revoke all on function private.relationship_has_exact_gmail_source(uuid,text,uuid) from public,anon,authenticated;
grant execute on function private.relationship_has_exact_gmail_source(uuid,text,uuid) to service_role;

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
 if p_limit is null or p_limit not between 1 and 100 then
   raise exception 'Reconciliation batch must be 1–100.' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(hashtext('relationship_email_anchor_repair_v1'));
 if not p_apply then
   select count(*) into v_eligible from (
     select t.issue_id
     from private.relationship_email_issue_triage t
     join public.relationship_reconciliation_issues i on i.id=t.issue_id and i.tenant_id=t.tenant_id and i.status='open'
     join public.relationship_communications cm on cm.id=t.observed_communication_id and cm.tenant_id=t.tenant_id
     join public.relationship_contacts c on c.id=cm.contact_id and c.tenant_id=cm.tenant_id
     where t.tenant_id='00000000-0000-0000-0000-000000000001'::uuid
       and t.review_state='needs_review' and t.source='gmail'
       and t.classification='existing_communication_needs_opportunity_review'
       and cm.opportunity_id is null and cm.organization_id is not null
       and private.relationship_has_exact_gmail_source(t.tenant_id,i.external_event_id,cm.id)
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
   join public.relationship_reconciliation_issues i on i.id=t.issue_id and i.tenant_id=t.tenant_id and i.status='open'
   join public.relationship_communications cm on cm.id=t.observed_communication_id and cm.tenant_id=t.tenant_id
   join public.relationship_contacts c on c.id=cm.contact_id and c.tenant_id=cm.tenant_id
   where t.tenant_id='00000000-0000-0000-0000-000000000001'::uuid
     and t.review_state='needs_review' and t.source='gmail'
     and t.classification='existing_communication_needs_opportunity_review'
     and cm.opportunity_id is null and cm.organization_id is not null
       and private.relationship_has_exact_gmail_source(t.tenant_id,i.external_event_id,cm.id)
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
     jsonb_build_object('rule','exact_provider_receipt_and_sole_compatible_opportunity',
       'source','gmail','receipt', (select to_jsonb(r) from private.relationship_gmail_source_receipts r join public.relationship_communications c on c.tenant_id=r.tenant_id and c.provider_message_id=r.provider_message_id where c.id=v.comm_id and c.tenant_id=v.tenant_id), 'no_stage_mutation',true,'no_outbound_action',true)
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