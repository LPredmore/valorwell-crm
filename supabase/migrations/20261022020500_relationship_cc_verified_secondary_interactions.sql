-- Secondary CC organization references are *interactions*, not duplicate emails
-- or stage transitions. Only exact single-contact/single-organization associations.
CREATE OR REPLACE FUNCTION private.record_cc_relationship_interactions_v1(
 p_tenant_id uuid, p_communication_id uuid, p_headers jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $link$
DECLARE
 v_primary public.relationship_communications%rowtype;
 v_raw text;
 v_address text;
 v_contact uuid;
 v_org uuid;
 v_opportunity uuid;
 v_unique integer;
 v_opps integer;
 v_added integer:=0;
BEGIN
 SELECT * INTO v_primary FROM public.relationship_communications
 WHERE tenant_id=p_tenant_id AND id=p_communication_id
   AND direction='outbound' AND provider='gmail';
 IF NOT FOUND THEN RETURN 0; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('relationship-cc:'||p_tenant_id::text||':'||p_communication_id::text));

 FOR v_raw IN SELECT DISTINCT btrim(x)
   FROM regexp_split_to_table(coalesce(private.relationship_header_value(p_headers,'cc'),''), ',') x
 LOOP
   v_address:=lower(btrim(coalesce(substring(v_raw FROM '<([^<>[:space:]]+@[^<>[:space:]]+)>'),
     substring(v_raw FROM '([^<>[:space:]]+@[^<>[:space:],]+)'),'')));
   IF v_address='' OR v_address=lower(coalesce(v_primary.recipient_email,'')) OR v_address='info@valorwell.org'
     THEN CONTINUE; END IF;

   -- A contact's verified organization link is required, with no duplicate
   -- or competing matches. A CC address by itself never proves ownership.
   SELECT count(*),(array_agg(c.id))[1],(array_agg(co.organization_id))[1]
     INTO v_unique,v_contact,v_org
   FROM public.relationship_contacts c
   JOIN public.relationship_contact_organizations co
     ON co.tenant_id=c.tenant_id AND co.contact_id=c.id
   WHERE c.tenant_id=p_tenant_id AND lower(btrim(c.email))=v_address;
   IF v_unique<>1 OR v_org IS NULL OR v_org IS NOT DISTINCT FROM v_primary.organization_id THEN
     CONTINUE;
   END IF;

   -- Add an active opportunity only when it is uniquely identified by the
   -- contact AND organization; never re-open a closed referring opportunity.
   SELECT count(*),(array_agg(o.id))[1] INTO v_opps,v_opportunity
   FROM public.relationship_opportunities o
   WHERE o.tenant_id=p_tenant_id AND o.organization_id=v_org
     AND o.primary_contact_id=v_contact
     AND o.status NOT IN ('completed','disqualified','declined');
   IF v_opps<>1 THEN v_opportunity:=NULL; END IF;

   IF NOT EXISTS (
     SELECT 1 FROM public.relationship_interactions i
     WHERE i.tenant_id=p_tenant_id AND i.organization_id=v_org
       AND i.contact_id=v_contact
       AND i.metadata->>'canonical_communication_id'=v_primary.id::text
       AND i.metadata->>'recipient_role'='cc'
   ) THEN
     INSERT INTO public.relationship_interactions (
       tenant_id,organization_id,contact_id,opportunity_id,
       interaction_type,occurred_at,summary,metadata
     ) VALUES (
       p_tenant_id,v_org,v_contact,v_opportunity,
       'outbound_email',v_primary.occurred_at,
       'CC recipient on a verified Gmail relationship communication.',
       jsonb_build_object('canonical_communication_id',v_primary.id,
         'recipient_role','cc','association','exact_contact_single_organization',
         'opportunity_ambiguity',v_opps>1)
     );
     v_added:=v_added+1;
   END IF;
 END LOOP;
 RETURN v_added;
END;
$link$;
REVOKE ALL ON FUNCTION private.record_cc_relationship_interactions_v1(uuid,uuid,jsonb)
 FROM PUBLIC, anon, authenticated, service_role;

-- Forward-only correction: drafts are never evidence of sent or received mail.
-- Preserve the deployed ingestion body, signature, ACLs and existing records.
CREATE OR REPLACE FUNCTION public.ingest_relationship_gmail_message(p_tenant_id uuid, p_gmail_message_id text, p_gmail_thread_id text, p_headers jsonb, p_from_email text, p_to_emails text[], p_subject text, p_body text, p_occurred_at timestamp with time zone, p_label_ids text[] DEFAULT '{}'::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_match jsonb;
  v_anchor public.relationship_communications%rowtype;
  v_comm public.relationship_communications%rowtype;
  v_direction text;
  v_rfc text:=private.relationship_header_value(p_headers,'message-id');
  v_in_reply text:=private.relationship_header_value(p_headers,'in-reply-to');
  v_recipient text;
  v_activity jsonb;
  v_candidate jsonb;
  v_classification text;
  v_reply_id uuid;
  v_existing_comm_id uuid;
begin
  if 'DRAFT'=any(coalesce(p_label_ids,'{}'::text[])) then
    return jsonb_build_object('observed',false,'reason','draft_message');
  end if;
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
  -- A reply lacking a prior outbound anchor can still be stored when the
  -- provider-authoritative mailbox, exact sender, contact, organization and
  -- single primary-contact BTY opportunity are independently established.
  -- No opportunity lifecycle, campaign or outbound-send mutation occurs.
  if coalesce((v_match->>'matched')::boolean,false) is not true then
    v_candidate:=private.find_exact_bty_inbound_candidate(
      p_tenant_id,p_from_email,p_to_emails,p_subject);
    if coalesce((v_candidate->>'safe')::boolean,false) then
      perform pg_advisory_xact_lock(hashtext('bty-gmail-exact:'||p_gmail_message_id));
      select o.communication_id into v_existing_comm_id
      from public.relationship_message_observations o
      where o.tenant_id=p_tenant_id and o.source='gmail'
        and o.provider_message_id=p_gmail_message_id;
      if v_existing_comm_id is not null then
        return jsonb_build_object('observed',true,'deduplicated',true,
          'communicationId',v_existing_comm_id);
      end if;
      v_classification:=private.classify_relationship_email(
        p_headers,p_subject,p_from_email);
      insert into public.relationship_communications(
        tenant_id,organization_id,contact_id,opportunity_id,direction,channel,
        status,sender_email,recipient_email,subject,rendered_body,provider,
        provider_message_id,provider_thread_id,occurred_at,metadata
      ) values (
        p_tenant_id,(v_candidate->>'organizationId')::uuid,
        (v_candidate->>'contactId')::uuid,
        (v_candidate->>'opportunityId')::uuid,
        'inbound','email','received',lower(btrim(p_from_email)),
        'info@valorwell.org',nullif(p_subject,''),coalesce(p_body,''),
        'gmail',p_gmail_message_id,nullif(btrim(p_gmail_thread_id),''),
        coalesce(p_occurred_at,now()),
        jsonb_build_object('classification',v_classification,
          'exact_bty_unanchored_capture',true,
          'campaign_reply_stop_not_inferred',true)
      ) returning * into v_comm;
      insert into public.relationship_message_observations(
        tenant_id,communication_id,source,provider_message_id,provider_thread_id,
        rfc_message_id,observed_at,metadata
      ) values (
        p_tenant_id,v_comm.id,'gmail',p_gmail_message_id,
        nullif(btrim(p_gmail_thread_id),''),v_rfc,coalesce(p_occurred_at,now()),
        jsonb_build_object('classification',v_classification,
          'exact_bty_unanchored_capture',true)
      );
      insert into private.relationship_email_unanchored_intake_audit(
        tenant_id,provider_message_id,communication_id,
        contact_id,organization_id,opportunity_id,classification,rule
      ) values (
        p_tenant_id,p_gmail_message_id,v_comm.id,v_comm.contact_id,
        v_comm.organization_id,v_comm.opportunity_id,v_classification,
        'exact_sender_one_org_one_primary_opportunity_bty_subject'
      );
      if v_classification='human' then
        insert into public.relationship_replies(
          tenant_id,communication_id,organization_id,contact_id,opportunity_id,
          status,metadata
        ) values (
          p_tenant_id,v_comm.id,v_comm.organization_id,v_comm.contact_id,
          v_comm.opportunity_id,'new',
          jsonb_build_object('exact_bty_unanchored_capture',true,
            'manual_campaign_review_required',true)
        ) returning id into v_reply_id;
      end if;
      insert into public.relationship_interactions(
        tenant_id,organization_id,contact_id,opportunity_id,interaction_type,
        occurred_at,summary,metadata
      ) values (
        p_tenant_id,v_comm.organization_id,v_comm.contact_id,v_comm.opportunity_id,
        case when v_classification='human' then 'inbound_reply' else 'system' end,
        v_comm.occurred_at,
        case when v_classification='human'
          then 'BTY Gmail inbound message captured; external reply needs follow-up review.'
          else 'Automated BTY Gmail response stored without lifecycle changes.' end,
        jsonb_build_object('communication_id',v_comm.id,'source','gmail',
          'exact_bty_unanchored_capture',true)
      );
      update public.relationship_reconciliation_issues
      set status='resolved',resolved_at=now(),opportunity_id=v_comm.opportunity_id,
        resolution='Exact sender, single organization and primary-contact BTY opportunity verified; message captured without changing campaign or opportunity lifecycle.',
        updated_at=now()
      where tenant_id=p_tenant_id and source='gmail'
        and issue_type='ambiguous_email_thread' and status='open'
        and external_event_id=p_gmail_message_id;
      update private.relationship_email_issue_triage t
      set review_state='approved',candidate_opportunity_id=v_comm.opportunity_id,
        observed_communication_id=v_comm.id,updated_at=now()
      where t.tenant_id=p_tenant_id and t.issue_id in (
        select i.id from public.relationship_reconciliation_issues i
        where i.tenant_id=p_tenant_id and i.source='gmail'
          and i.external_event_id=p_gmail_message_id
          and i.status='resolved'
      );
      return jsonb_build_object('observed',true,'deduplicated',false,
        'exactUnanchored',true,'communicationId',v_comm.id,
        'classification',v_classification,'replyId',v_reply_id,
        'campaignReviewRequired',v_classification='human');
    end if;
  end if;
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
  perform private.record_cc_relationship_interactions_v1(p_tenant_id,v_comm.id,p_headers);
  v_activity:=private.apply_relationship_activity(
    p_tenant_id,'manual_outbound_email','gmail','gmail-message:'||p_gmail_message_id,p_gmail_message_id,
    v_comm.organization_id,v_comm.contact_id,v_comm.opportunity_id,v_comm.campaign_id,
    v_comm.enrollment_id,v_comm.id,v_comm.occurred_at,jsonb_build_object('gmail_thread_id',p_gmail_thread_id),null
  );
  return jsonb_build_object('observed',true,'deduplicated',false,'communicationId',v_comm.id,'activity',v_activity);
end;
$function$

