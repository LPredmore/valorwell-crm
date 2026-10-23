-- STAGED ONLY. Requires reviewed dependency/catalog receipt and isolated signed-JWT
-- acceptance before an explicitly approved forward release. Do not alter old ledger.
-- Minimal Gmail runtime closure; no task cleanup, link repair, CC, calendar or cron changes.
DO $guard$
BEGIN
 IF to_regclass('public.tenants') IS NULL
    OR to_regclass('public.relationship_reconciliation_issues') IS NULL
    OR to_regprocedure('public.get_relationship_google_sync_state(uuid)') IS NULL
    OR to_regprocedure('public.update_relationship_google_sync_state(uuid,text,timestamp with time zone,text,boolean,boolean,boolean,text,text)') IS NULL
    OR to_regprocedure('public.match_relationship_gmail_message(uuid,text,text,jsonb,text,text[],text)') IS NULL
    OR to_regprocedure('public.ingest_relationship_gmail_message(uuid,text,text,jsonb,text,text[],text,text,timestamp with time zone,text[])') IS NULL THEN
   RAISE EXCEPTION 'Gmail repair dependency contract missing.';
 END IF;
 -- Do not replace a concurrently restored/reviewed implementation.
 IF to_regclass('private.relationship_gmail_source_receipts') IS NOT NULL
    OR to_regprocedure('public.record_relationship_gmail_source_receipt(uuid,text,text,text,jsonb,jsonb)') IS NOT NULL
    OR to_regprocedure('public.record_relationship_gmail_retrieval_failure(text,text)') IS NOT NULL THEN
   RAISE EXCEPTION 'Gmail source objects already exist: re-inspect before release, do not overwrite.';
 END IF;
END;
$guard$;

CREATE TABLE private.relationship_gmail_source_receipts (
 tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 provider_message_id text NOT NULL CHECK(length(provider_message_id)>0),
 provider_thread_id text NOT NULL CHECK(length(provider_thread_id)>0),
 mailbox text NOT NULL CHECK(mailbox='info@valorwell.org'),
 headers jsonb NOT NULL,
 label_ids jsonb NOT NULL,
 retrieved_at timestamptz NOT NULL DEFAULT now(),
 provenance text NOT NULL DEFAULT 'gmail.messages.get/full' CHECK(provenance='gmail.messages.get/full'),
 PRIMARY KEY(tenant_id,provider_message_id)
);
ALTER TABLE private.relationship_gmail_source_receipts OWNER TO postgres;
ALTER TABLE private.relationship_gmail_source_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.relationship_gmail_source_receipts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON private.relationship_gmail_source_receipts TO service_role;

CREATE FUNCTION public.record_relationship_gmail_source_receipt(
 p_tenant_id uuid,p_message_id text,p_thread_id text,p_mailbox text,p_headers jsonb,p_label_ids jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $receipt$
BEGIN
 IF p_tenant_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid
    OR p_mailbox IS DISTINCT FROM 'info@valorwell.org'
    OR nullif(btrim(p_message_id),'') IS NULL OR nullif(btrim(p_thread_id),'') IS NULL
    OR jsonb_typeof(p_headers) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_label_ids) IS DISTINCT FROM 'array'
    OR p_label_ids ? 'DRAFT' THEN
   RAISE EXCEPTION 'Invalid authoritative Gmail receipt.' USING errcode='22023';
 END IF;
 INSERT INTO private.relationship_gmail_source_receipts
   (tenant_id,provider_message_id,provider_thread_id,mailbox,headers,label_ids)
 VALUES(p_tenant_id,p_message_id,p_thread_id,p_mailbox,p_headers,p_label_ids)
 ON CONFLICT(tenant_id,provider_message_id) DO UPDATE SET
   headers=excluded.headers,label_ids=excluded.label_ids,retrieved_at=now()
 WHERE relationship_gmail_source_receipts.provider_thread_id=excluded.provider_thread_id
   AND (nullif(relationship_gmail_source_receipts.headers->>'message-id','') IS NULL
     OR relationship_gmail_source_receipts.headers->>'message-id'=excluded.headers->>'message-id');
 IF NOT FOUND THEN RAISE EXCEPTION 'Conflicting Gmail identity.' USING errcode='22023'; END IF;
END;
$receipt$;
ALTER FUNCTION public.record_relationship_gmail_source_receipt(uuid,text,text,text,jsonb,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_relationship_gmail_source_receipt(uuid,text,text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_relationship_gmail_source_receipt(uuid,text,text,text,jsonb,jsonb) TO service_role;

CREATE FUNCTION public.record_relationship_gmail_retrieval_failure(p_message_id text,p_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $failure$
BEGIN
 IF p_status IS NULL OR p_status NOT IN ('NOT_FOUND','FORBIDDEN','UNAVAILABLE','MISMATCH')
    OR nullif(btrim(p_message_id),'') IS NULL THEN
   RAISE EXCEPTION 'Invalid source retrieval outcome.' USING errcode='22023';
 END IF;
 INSERT INTO public.relationship_reconciliation_issues(tenant_id,issue_type,source,external_event_id,summary,details)
 VALUES('00000000-0000-0000-0000-000000000001','sync_error','gmail',p_message_id,
   'Gmail source retrieval requires review',jsonb_build_object('retrieval_status',p_status,'checked_at',now(),
     'interpretation','Retrieval outcome is not proof of deletion or non-delivery.'))
 ON CONFLICT(tenant_id,issue_type,source,external_event_id) WHERE status='open' AND external_event_id IS NOT NULL
 DO UPDATE SET details=relationship_reconciliation_issues.details||excluded.details,updated_at=now();
END;
$failure$;
ALTER FUNCTION public.record_relationship_gmail_retrieval_failure(text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_relationship_gmail_retrieval_failure(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_relationship_gmail_retrieval_failure(text,text) TO service_role;

-- Non-mutating PostgREST deployment handshake. Never probe writers with fake mail.
CREATE FUNCTION public.get_relationship_gmail_runtime_contract()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $contract$
DECLARE v_signature text; v_oid oid; v_missing jsonb:='[]';
BEGIN
 FOREACH v_signature IN ARRAY ARRAY[
  'public.record_relationship_gmail_source_receipt(uuid,text,text,text,jsonb,jsonb)',
  'public.record_relationship_gmail_retrieval_failure(text,text)',
  'public.get_relationship_google_sync_state(uuid)',
  'public.update_relationship_google_sync_state(uuid,text,timestamp with time zone,text,boolean,boolean,boolean,text,text)',
  'public.match_relationship_gmail_message(uuid,text,text,jsonb,text,text[],text)',
  'public.ingest_relationship_gmail_message(uuid,text,text,jsonb,text,text[],text,text,timestamp with time zone,text[])',
  'public.claim_relationship_gmail_backfill(uuid,uuid,integer)',
  'public.checkpoint_relationship_gmail_backfill(uuid,uuid,text,text,boolean,integer,integer,integer,integer)',
  'public.release_relationship_gmail_backfill(uuid,uuid,text,text)'
 ] LOOP
  v_oid:=to_regprocedure(v_signature);
  IF v_oid IS NULL THEN
   v_missing:=v_missing||jsonb_build_array(v_signature);
  ELSIF NOT has_function_privilege('service_role',v_oid,'EXECUTE')
     OR has_function_privilege('anon',v_oid,'EXECUTE')
     OR has_function_privilege('authenticated',v_oid,'EXECUTE')
     OR NOT EXISTS(select 1 from pg_proc p where p.oid=v_oid AND p.prosecdef
       AND pg_get_userbyid(p.proowner)='postgres' AND p.proconfig @> ARRAY['search_path=""']) THEN
   v_missing:=v_missing||jsonb_build_array(v_signature||':unsafe_contract');
  END IF;
 END LOOP;
 IF NOT EXISTS(select 1 from pg_class c where c.oid=to_regclass('private.relationship_gmail_source_receipts')
   AND c.relrowsecurity AND pg_get_userbyid(c.relowner)='postgres')
   OR has_table_privilege('anon','private.relationship_gmail_source_receipts','SELECT,INSERT,UPDATE,DELETE')
   OR has_table_privilege('authenticated','private.relationship_gmail_source_receipts','SELECT,INSERT,UPDATE,DELETE') THEN
  v_missing:=v_missing||jsonb_build_array('private.relationship_gmail_source_receipts:unsafe_contract');
 END IF;
 RETURN jsonb_build_object('contractVersion',1,'ready',jsonb_array_length(v_missing)=0,'failures',v_missing);
END;
$contract$;
ALTER FUNCTION public.get_relationship_gmail_runtime_contract() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_relationship_gmail_runtime_contract() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_relationship_gmail_runtime_contract() TO service_role;
-- Schema cache reload is transactional and follows object creation, never substitutes for it.
NOTIFY pgrst,'reload schema';