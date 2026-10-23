-- Deterministic, tenant-scoped, read-only inventory. Stored claims are explicitly
-- distinguished from independently retrieved provider receipts. No message body.
create or replace function private.relationship_email_source_recovery(p_tenant uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object(
   'issueId',i.id,'claimedMessageId',i.external_event_id,
   'threadId',i.details->>'gmail_thread_id',
   'organizationId',coalesce(i.details#>>'{next_review_20261022,thread_organization_id}',
     i.details#>>'{thread_organization_review_20261022,organization_id}',tri.candidate_organization_id::text,cm.organization_id::text),
   'opportunityCandidate',coalesce(tri.candidate_opportunity_id::text,
     i.details#>>'{next_review_20261022,thread_opportunity_id}',i.opportunity_id::text),
   'route',i.details#>>'{next_review_20261022,route}',
   'exactIdentityVerified',r.provider_message_id is not null,
   'safelyRepairable',coalesce(private.relationship_has_exact_gmail_source(i.tenant_id,i.external_event_id,cm.id),false)
     and cm.opportunity_id is null and tri.review_state='needs_review'
     and tri.classification='existing_communication_needs_opportunity_review'
     and cm.subject ~* '(beyond the yellow|(^|[^a-z])bty([^a-z]|$)|nominat|recommend)'
     and exists(select 1 from public.relationship_contacts c where c.id=cm.contact_id and c.tenant_id=cm.tenant_id
       and ((cm.direction='inbound' and lower(cm.sender_email)=lower(c.email)) or (cm.direction='outbound' and lower(cm.recipient_email)=lower(c.email))))
     and (select count(*) from public.relationship_opportunities op where op.tenant_id=cm.tenant_id
       and op.organization_id=cm.organization_id and (op.primary_contact_id=cm.contact_id or op.primary_contact_id is null))=1,
   'sourceStatus',case when r.provider_message_id is not null then 'VERIFIED_EXACT_PROVIDER_ID'
     when i.details->>'retrieval_status' in ('FORBIDDEN','NOT_FOUND','UNAVAILABLE','MISMATCH') then i.details->>'retrieval_status'
     when upper(i.details#>>'{provider_evidence_20261022,status}') in ('FORBIDDEN','NOT_FOUND','MISMATCH') then upper(i.details#>>'{provider_evidence_20261022,status}')
     when i.details#>>'{provider_evidence_20261022,id_present_in_thread_result}'='false' then 'ABSENT_FROM_ACCESSIBLE_THREAD'
     else 'SOURCE_DATA_UNAVAILABLE' end,
   'reason',case when r.provider_message_id is not null then 'Exact provider retrieval receipt; association repair has additional gates.'
     else 'No independent exact-message retrieval receipt. Thread/CRM/import records are leads, not proof of original send or deletion.' end,
   'humanReviewRequired',coalesce(i.details#>>'{next_review_20261022,user_one_to_one_needed}'='true',false),
   'providerRetrievalRequired',r.provider_message_id is null,
   'evidence',jsonb_build_object('receiptRetrievedAt',r.retrieved_at,'receiptProvenance',r.provenance,
     'storedCommunicationId',cm.id,
     'exactObservationIds',(select coalesce(jsonb_agg(o.id order by o.id),'[]'::jsonb) from public.relationship_message_observations o
       where o.tenant_id=i.tenant_id and o.source=i.source and o.provider_message_id=i.external_event_id),
     'storedRfcIds',(select coalesce(jsonb_agg(distinct o.rfc_message_id) filter(where o.rfc_message_id is not null),'[]'::jsonb)
       from public.relationship_message_observations o where o.tenant_id=i.tenant_id and o.source=i.source and o.provider_message_id=i.external_event_id),
     'crmEmailIds',(select coalesce(jsonb_agg(e.id order by e.id),'[]'::jsonb) from public.crm_email_messages e
       where e.tenant_id=i.tenant_id and e.provider=i.source and e.provider_message_id=i.external_event_id),
     'activityIds',(select coalesce(jsonb_agg(a.id order by a.id),'[]'::jsonb) from public.relationship_activity_events a
       where a.tenant_id=i.tenant_id and a.source=i.source and (a.external_event_id=i.external_event_id or a.id=i.activity_event_id)),
     'laterDistinctMessageRecorded',i.details ? 'later_distinct_gmail_message_20261022',
     'priorSourceCheck',i.details#>>'{provider_evidence_20261022,scope}')
 ) order by i.id),'[]'::jsonb)
 from public.relationship_reconciliation_issues i
 left join private.relationship_email_issue_triage tri on tri.issue_id=i.id and tri.tenant_id=i.tenant_id
 left join public.relationship_communications cm on cm.id=tri.observed_communication_id and cm.tenant_id=i.tenant_id
 left join private.relationship_gmail_source_receipts r on r.tenant_id=i.tenant_id and r.provider_message_id=i.external_event_id and i.source='gmail'
 where i.tenant_id=p_tenant and i.status='open' and i.source in ('gmail','resend');
$$;
revoke all on function private.relationship_email_source_recovery(uuid) from public,anon,authenticated;
grant execute on function private.relationship_email_source_recovery(uuid) to service_role;

create or replace function public.get_relationship_email_source_recovery()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_context jsonb;
begin
 v_context:=private.relationship_orchestration_context(false);
 return private.relationship_email_source_recovery((v_context->>'tenant_id')::uuid);
end;
$$;
revoke all on function public.get_relationship_email_source_recovery() from public,anon,authenticated;
grant execute on function public.get_relationship_email_source_recovery() to authenticated;

create or replace function public.get_relationship_gmail_diagnostics()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_context jsonb;
begin
 v_context:=private.relationship_orchestration_context(false);
 return coalesce((select jsonb_agg(jsonb_build_object(
   'connectionId',c.id,'lastSuccessfulSyncAt',s.last_successful_sync_at,
   'lastPushAt',s.last_notification_at,'lastErrorCode',s.last_error_code,
   'lastErrorReason',s.last_error_reason,'watchExpiration',s.gmail_watch_expiration,
   'secondsSinceSuccessfulSync',case when s.last_successful_sync_at is null then null else greatest(0,extract(epoch from(now()-s.last_successful_sync_at))) end,
   'pushAwaitingSuccessfulSync',s.last_notification_at>s.last_successful_sync_at
 ) order by c.id) from private.relationship_google_connections c
 left join private.relationship_google_sync_state s on s.connection_id=c.id
 where c.tenant_id=(v_context->>'tenant_id')::uuid and c.connection_type='gmail' and c.status<>'revoked'),'[]'::jsonb);
end;
$$;
revoke all on function public.get_relationship_gmail_diagnostics() from public,anon,authenticated;
grant execute on function public.get_relationship_gmail_diagnostics() to authenticated;

create or replace function public.record_relationship_gmail_retrieval_failure(p_message_id text,p_status text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_status not in ('NOT_FOUND','FORBIDDEN','UNAVAILABLE','MISMATCH') or nullif(p_message_id,'') is null then
   raise exception 'Invalid source retrieval outcome.';
 end if;
 insert into public.relationship_reconciliation_issues(tenant_id,issue_type,source,external_event_id,summary,details)
 values('00000000-0000-0000-0000-000000000001','sync_error','gmail',p_message_id,
   'Gmail source retrieval requires review',jsonb_build_object('retrieval_status',p_status,'checked_at',now(),
     'interpretation','Retrieval outcome is not proof of deletion or non-delivery.'))
 on conflict(tenant_id,issue_type,source,external_event_id) where status='open' and external_event_id is not null
 do update set details=relationship_reconciliation_issues.details||excluded.details,updated_at=now();
end;
$$;
revoke all on function public.record_relationship_gmail_retrieval_failure(text,text) from public,anon,authenticated;
grant execute on function public.record_relationship_gmail_retrieval_failure(text,text) to service_role;