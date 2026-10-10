-- Clinician recruitment sequences are intentionally draft-only.
-- They are NOT the existing sendable CRM campaigns, and have no sender.
CREATE TABLE public.crm_recruitment_draft_sequences(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 3 AND 120),
 description text NOT NULL DEFAULT '',
 state_filter text,
 license_filter text,
 status text NOT NULL DEFAULT 'draft' CHECK(status='draft'),
 created_by uuid NOT NULL REFERENCES public.profiles(id),
 updated_by uuid NOT NULL REFERENCES public.profiles(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id)
);
CREATE TABLE public.crm_recruitment_draft_steps(
 tenant_id uuid NOT NULL,
 sequence_id uuid NOT NULL,
 step_order integer NOT NULL CHECK(step_order BETWEEN 1 AND 6),
 delay_days integer NOT NULL CHECK(delay_days BETWEEN 0 AND 90),
 subject text NOT NULL CHECK(length(btrim(subject)) BETWEEN 3 AND 200),
 body_text text NOT NULL CHECK(length(btrim(body_text)) BETWEEN 10 AND 6000),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,sequence_id,step_order),
 FOREIGN KEY (tenant_id,sequence_id) REFERENCES public.crm_recruitment_draft_sequences(tenant_id,id) ON DELETE CASCADE
);
ALTER TABLE public.crm_recruitment_draft_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_recruitment_draft_steps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_recruitment_draft_sequences FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.crm_recruitment_draft_steps FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.crm_recruitment_save_draft(
 p_tenant_id uuid,p_sequence_id uuid,p_name text,p_description text,
 p_state_filter text,p_license_filter text,p_steps jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE actor uuid:=(SELECT auth.uid()); sid uuid; item jsonb; idx integer:=0;
DECLARE s text;b text;d integer;
BEGIN
 IF actor IS NULL OR
 NOT coalesce(private.crm_has_relationship_permission(actor,p_tenant_id,'edit_relationships'),false)
 OR public.crm_staff_tenant_for_applicant_pipeline() IS DISTINCT FROM p_tenant_id
 THEN RAISE EXCEPTION 'Recruitment drafts access denied' USING ERRCODE='42501'; END IF;
 IF length(btrim(coalesce(p_name,''))) NOT BETWEEN 3 AND 120
 OR length(coalesce(p_description,''))>2000
 OR p_steps IS NULL OR jsonb_typeof(p_steps)<>'array'
 OR jsonb_array_length(p_steps) NOT BETWEEN 1 AND 6
 OR length(btrim(coalesce(p_state_filter,'')))>2
 OR length(btrim(coalesce(p_license_filter,'')))>120
 THEN RAISE EXCEPTION 'Invalid sequence settings'; END IF;
 IF nullif(btrim(coalesce(p_state_filter,'')),'') IS NOT NULL AND
 upper(p_state_filter) !~ '^[A-Z]{2}$' THEN RAISE EXCEPTION 'Invalid state code'; END IF;
 IF p_sequence_id IS NULL THEN
   INSERT INTO public.crm_recruitment_draft_sequences
   (tenant_id,name,description,state_filter,license_filter,created_by,updated_by)
   VALUES(p_tenant_id,btrim(p_name),coalesce(p_description,''),
    nullif(upper(btrim(coalesce(p_state_filter,''))),''),
    nullif(btrim(coalesce(p_license_filter,'')),''),actor,actor)
   RETURNING id INTO sid;
 ELSE
   UPDATE public.crm_recruitment_draft_sequences
   SET name=btrim(p_name),description=coalesce(p_description,''),
    state_filter=nullif(upper(btrim(coalesce(p_state_filter,''))),''),
    license_filter=nullif(btrim(coalesce(p_license_filter,'')),''),
    updated_by=actor,updated_at=now()
   WHERE tenant_id=p_tenant_id AND id=p_sequence_id AND status='draft'
   RETURNING id INTO sid;
   IF sid IS NULL THEN RAISE EXCEPTION 'Draft sequence unavailable in tenant' USING ERRCODE='42501'; END IF;
   DELETE FROM public.crm_recruitment_draft_steps WHERE tenant_id=p_tenant_id AND sequence_id=sid;
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_steps) LOOP
   idx:=idx+1;
   s:=btrim(coalesce(item->>'subject',''));
   b:=btrim(coalesce(item->>'bodyText',''));
   IF jsonb_typeof(item->'delayDays')<>'number'
    OR (item->>'delayDays') !~ '^[0-9]{1,2}$'
   THEN RAISE EXCEPTION 'Step delay must be integer days'; END IF;
   d:=(item->>'delayDays')::integer;
   IF length(s) NOT BETWEEN 3 AND 200 OR length(b) NOT BETWEEN 10 AND 6000 OR d>90
   THEN RAISE EXCEPTION 'Invalid step content'; END IF;
   INSERT INTO public.crm_recruitment_draft_steps
   (tenant_id,sequence_id,step_order,delay_days,subject,body_text)
   VALUES(p_tenant_id,sid,idx,d,s,b);
 END LOOP;
 RETURN sid;
END $fn$;
REVOKE ALL ON FUNCTION public.crm_recruitment_save_draft(uuid,uuid,text,text,text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_recruitment_save_draft(uuid,uuid,text,text,text,text,jsonb) TO authenticated;

CREATE FUNCTION public.crm_recruitment_draft_workspace(p_tenant_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE result jsonb;
BEGIN
 IF (SELECT auth.uid()) IS NULL OR
 NOT coalesce(private.crm_has_relationship_permission(auth.uid(),p_tenant_id,'view_relationships'),false)
 OR public.crm_staff_tenant_for_applicant_pipeline() IS DISTINCT FROM p_tenant_id
 THEN RAISE EXCEPTION 'Recruitment drafts access denied' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'id',s.id,'name',s.name,'description',s.description,
  'stateFilter',s.state_filter,'licenseFilter',s.license_filter,
  'status',s.status,'updatedAt',s.updated_at,
  'steps',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'stepOrder',st.step_order,'delayDays',st.delay_days,'subject',st.subject,'bodyText',st.body_text)
   ORDER BY st.step_order) FROM public.crm_recruitment_draft_steps st
   WHERE st.tenant_id=s.tenant_id AND st.sequence_id=s.id),'[]'::jsonb))
  ORDER BY s.updated_at DESC),'[]'::jsonb) INTO result
 FROM public.crm_recruitment_draft_sequences s WHERE s.tenant_id=p_tenant_id;
 RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION public.crm_recruitment_draft_workspace(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_recruitment_draft_workspace(uuid) TO authenticated;

CREATE FUNCTION public.crm_recruitment_draft_preview(p_tenant_id uuid,p_sequence_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE seq public.crm_recruitment_draft_sequences%ROWTYPE;
DECLARE preview jsonb;
BEGIN
 IF (SELECT auth.uid()) IS NULL OR
 NOT coalesce(private.crm_has_relationship_permission(auth.uid(),p_tenant_id,'view_relationships'),false)
 OR public.crm_staff_tenant_for_applicant_pipeline() IS DISTINCT FROM p_tenant_id
 THEN RAISE EXCEPTION 'Recruitment draft preview denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO seq FROM public.crm_recruitment_draft_sequences
 WHERE tenant_id=p_tenant_id AND id=p_sequence_id AND status='draft';
 IF NOT FOUND THEN RAISE EXCEPTION 'Draft not found in tenant' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object(
  'matched',count(*),
  'formatValid',count(*) FILTER (WHERE q.email_quality='valid'),
  'missing',count(*) FILTER (WHERE q.email_quality='missing'),
  'invalid',count(*) FILTER (WHERE q.email_quality='invalid'),
  'suppressed',count(*) FILTER (WHERE q.suppressed),
  'manuallyVerified',count(*) FILTER (WHERE q.email_review='verified'),
  'technicallyReady',count(*) FILTER (WHERE q.preview_eligible),
  'approvedForSending',0,
  'sendingEnabled',false,
  'notice','Draft preview only. No consent established, recipients enrolled, or messages sent.')
 INTO preview FROM private.crm_recruitment_quality_rows(p_tenant_id) q
 WHERE (seq.state_filter IS NULL OR upper(btrim(q.state_code))=seq.state_filter
  OR coalesce(q.licensed_states,'[]'::jsonb) ? seq.state_filter)
 AND (seq.license_filter IS NULL OR lower(coalesce(q.item->>'licenseType','')) LIKE '%'||lower(seq.license_filter)||'%');
 RETURN preview;
END $fn$;
REVOKE ALL ON FUNCTION public.crm_recruitment_draft_preview(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_recruitment_draft_preview(uuid,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';