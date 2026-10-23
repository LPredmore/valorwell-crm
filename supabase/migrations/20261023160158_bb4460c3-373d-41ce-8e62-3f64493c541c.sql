-- Secondary CC organization references are *interactions*, not duplicate emails
-- or stage transitions. Only exact single-contact/single-organization associations.
CREATE OR REPLACE FUNCTION private.record_cc_relationship_interactions_v1(
 p_tenant_id uuid, p_communication_id uuid, p_headers jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $link$
DECLARE
 v_primary public.relationship_communications%rowtype;
 v_raw text;
 v_role text;
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

 FOR v_role,v_raw IN SELECT DISTINCT role,btrim(x) FROM (values ('to'),('cc')) roles(role)
   CROSS JOIN LATERAL regexp_split_to_table(coalesce(private.relationship_header_value(p_headers,role),''), ',') x
   ORDER BY role DESC,btrim(x)
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
   IF v_unique<>1 OR v_org IS NULL THEN
     INSERT INTO public.relationship_reconciliation_issues(
       tenant_id,issue_type,source,external_event_id,summary,details)
     VALUES(p_tenant_id,'ambiguous_email_thread','gmail',v_primary.provider_message_id,
       'Secondary Gmail recipient organization requires review',
       jsonb_build_object('gmail_thread_id',v_primary.provider_thread_id,
         'communication_id',v_primary.id,'recipient_review',jsonb_build_object(v_address,v_role)))
     ON CONFLICT(tenant_id,issue_type,source,external_event_id) WHERE status='open' AND external_event_id IS NOT NULL
     DO UPDATE SET details=relationship_reconciliation_issues.details||jsonb_build_object('recipient_review',
       coalesce(relationship_reconciliation_issues.details->'recipient_review','{}'::jsonb)||(excluded.details->'recipient_review')),updated_at=now();
     CONTINUE;
   END IF;
   IF v_org IS NOT DISTINCT FROM v_primary.organization_id THEN
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
       AND i.metadata->>'recipient_role' in ('cc','to')
   ) THEN
     INSERT INTO public.relationship_interactions (
       tenant_id,organization_id,contact_id,opportunity_id,
       interaction_type,occurred_at,summary,metadata
     ) VALUES (
       p_tenant_id,v_org,v_contact,v_opportunity,
       'outbound_email',v_primary.occurred_at,
       upper(v_role)||' recipient on a verified Gmail relationship communication.',
       jsonb_build_object('canonical_communication_id',v_primary.id,
         'recipient_role',v_role,'association','exact_contact_single_organization',
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