-- Only explicitly matched, tenant-scoped inbound triage entries appear in prospect history.
CREATE OR REPLACE FUNCTION public.crm_recruitment_communication_timeline(p_tenant_id uuid, p_prospect_id uuid, p_limit integer DEFAULT 80)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v jsonb;v_email text;v_applicant uuid;v_verified boolean;v_matches integer;
BEGIN
 IF (select auth.uid()) IS NULL
 OR NOT coalesce(private.crm_has_relationship_permission(auth.uid(),p_tenant_id,'view_relationships'),false)
 OR public.crm_staff_tenant_for_applicant_pipeline() IS DISTINCT FROM p_tenant_id
 THEN RAISE EXCEPTION 'Recruitment timeline access denied' USING ERRCODE='42501'; END IF;
 SELECT lower(btrim(p.email)),w.email_review_status='verified'
 INTO v_email,v_verified FROM public.therapist_outreach_prospects p
 JOIN public.crm_therapist_prospect_workflow w ON w.tenant_id=p.tenant_id AND w.prospect_id=p.id
 WHERE p.tenant_id=p_tenant_id AND p.id=p_prospect_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Prospect not found in tenant' USING ERRCODE='42501'; END IF;
 SELECT applicant_id INTO v_applicant FROM public.crm_therapist_prospect_applicant_links
 WHERE tenant_id=p_tenant_id AND prospect_id=p_prospect_id;
 SELECT count(*) INTO v_matches FROM public.therapist_outreach_prospects p
 WHERE p.tenant_id=p_tenant_id AND v_email<>'' AND lower(btrim(p.email))=v_email;
 WITH raw AS (
  SELECT e.created_at AS at,e.id::text AS event_id,'crm_change'::text AS source,
    'internal'::text AS channel,'internal'::text AS direction,
    'recorded'::text AS status,'CRM review history'::text AS subject,
    e.reason AS summary,NULL::text AS thread_id
   FROM public.crm_therapist_prospect_events e
   WHERE e.tenant_id=p_tenant_id AND e.prospect_id=p_prospect_id
  UNION ALL
  SELECT e.occurred_at,e.id::text,'manual_activity',e.channel,e.direction,
   e.outcome,'Recruiter activity',
   concat('Logged by ',coalesce((SELECT nullif(concat_ws(' ',s.prov_name_f,s.prov_name_l),'')
      FROM public.staff s WHERE s.tenant_id=p_tenant_id AND s.profile_id=e.actor_profile_id LIMIT 1),e.actor_profile_id::text),': ',e.summary),NULL::text
  FROM public.crm_therapist_prospect_contact_events e
   WHERE e.tenant_id=p_tenant_id AND e.prospect_id=p_prospect_id
  UNION ALL
  SELECT m.occurred_at,m.id::text,'applicant_email','email',m.direction,
   m.status,coalesce(m.subject,'(No subject)'),
   left(concat('From: ',coalesce(m.sender_email,'?'),' · To: ',coalesce(m.recipient_email,'?'),' · ',
     coalesce(nullif(m.body_text,''),nullif(regexp_replace(coalesce(m.body_html,''),'<[^>]*>',' ','g'),''),'No stored text')),900),m.provider_thread_id
  FROM public.crm_email_messages m
   WHERE v_applicant IS NOT NULL AND m.tenant_id=p_tenant_id
    AND m.provider_applicant_id=v_applicant
  UNION ALL
  SELECT a.occurred_at,a.id::text,'applicant_activity','internal','internal',
   a.event_type,'Applicant event',
   left(coalesce(nullif(a.note,''),a.event_type),1000),NULL::text
  FROM public.provider_applicant_activity_events a
   WHERE v_applicant IS NOT NULL AND a.tenant_id=p_tenant_id AND a.applicant_id=v_applicant
  UNION ALL
  SELECT t.occurred_at,t.id::text,'recruitment_reply','email','inbound',
   t.review_status,coalesce(m.subject,'(No subject)'),
   left(concat('Incoming clinician reply classified as ',t.classification,
    '. Review status: ',t.review_status,
    '. ',coalesce(nullif(m.body_text,''),nullif(regexp_replace(coalesce(m.body_html,''),'<[^>]*>',' ','g'),''),'No stored text')),900),
   m.provider_thread_id
  FROM public.crm_recruitment_inbound_triage t
  JOIN public.crm_email_messages m ON m.tenant_id=t.tenant_id AND m.id=t.email_message_id
  WHERE t.tenant_id=p_tenant_id AND t.prospect_id=p_prospect_id
  UNION ALL
  SELECT c.occurred_at,c.id::text,'relationship_email',c.channel,c.direction,c.status,
   coalesce(c.subject,'(No subject)'),
   left(concat('From: ',coalesce(c.sender_email,'?'),' · To: ',coalesce(c.recipient_email,'?'),' · ',
     coalesce(nullif(c.rendered_text,''),nullif(regexp_replace(coalesce(c.rendered_body,''),'<[^>]*>',' ','g'),''),'No stored text')),900),c.provider_thread_id
  FROM public.relationship_communications c
  WHERE coalesce(v_verified,false) AND v_matches=1
   AND v_email ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
   AND c.tenant_id=p_tenant_id AND c.channel='email'
   AND (CASE WHEN c.direction='inbound' THEN lower(btrim(coalesce(c.sender_email,'')))=v_email
             ELSE lower(btrim(coalesce(c.recipient_email,'')))=v_email END)
 ), recent AS (
 SELECT * FROM raw ORDER BY at DESC,event_id DESC LIMIT greatest(1,least(coalesce(p_limit,80),100))
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'at',at,'id',event_id,'source',source,'channel',channel,'direction',direction,
   'status',status,'subject',subject,'summary',summary,'threadId',thread_id)
   ORDER BY at DESC,event_id DESC),'[]'::jsonb) INTO v FROM recent;
 RETURN v;
END $function$
;
REVOKE ALL ON FUNCTION public.crm_recruitment_communication_timeline(uuid,uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_recruitment_communication_timeline(uuid,uuid,integer) TO authenticated;