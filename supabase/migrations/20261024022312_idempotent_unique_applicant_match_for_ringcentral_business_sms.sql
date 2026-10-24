-- CRM identity-safe applicant linkage for exact business SMS. Deny client-ambiguous matches.
CREATE OR REPLACE FUNCTION public.valorwell_link_sms_unique_applicant_v1(p_ringcentral_message_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_sms public.crm_inbound_sms_logs%rowtype;v_count integer;v_clients integer;v_id uuid;v_digits text;
BEGIN
 IF NOT private.valorwell_is_service_role() THEN
   RAISE EXCEPTION 'ROLE_DENIED' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_sms FROM public.crm_inbound_sms_logs s
 WHERE s.ringcentral_message_id=p_ringcentral_message_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('matched',false,'reason','missing_sms'); END IF;
 IF v_sms.client_id IS NOT NULL THEN RETURN jsonb_build_object('matched',false,'reason','client_owned'); END IF;
 IF v_sms.provider_applicant_id IS NOT NULL THEN
   RETURN jsonb_build_object('matched',true,'applicant_id',v_sms.provider_applicant_id,'received_at',v_sms.received_at,'already_linked',true);
 END IF;
 v_digits:=right(regexp_replace(coalesce(v_sms.from_phone,''),'[^0-9]','','g'),10);
 IF length(v_digits)<>10 THEN RETURN jsonb_build_object('matched',false,'reason','invalid_phone'); END IF;
 SELECT count(*) INTO v_clients FROM public.clients c
 WHERE c.tenant_id=v_sms.tenant_id AND right(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g'),10)=v_digits;
 IF v_clients<>0 THEN RETURN jsonb_build_object('matched',false,'reason','clinical_identity_review_needed'); END IF;
 SELECT count(*),(array_agg(a.id ORDER BY a.id))[1] INTO v_count,v_id FROM public.provider_applicants a
 WHERE a.tenant_id=v_sms.tenant_id AND right(regexp_replace(coalesce(a.phone,''),'[^0-9]','','g'),10)=v_digits;
 IF v_count<>1 THEN RETURN jsonb_build_object('matched',false,'reason',CASE WHEN v_count=0 THEN 'no_applicant_match' ELSE 'ambiguous_applicant_match' END); END IF;
 UPDATE public.crm_inbound_sms_logs SET provider_applicant_id=v_id WHERE id=v_sms.id;
 RETURN jsonb_build_object('matched',true,'applicant_id',v_id,'received_at',v_sms.received_at,'already_linked',false);
END;
$function$;

REVOKE ALL ON FUNCTION public.valorwell_link_sms_unique_applicant_v1(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.valorwell_link_sms_unique_applicant_v1(text) TO service_role;
