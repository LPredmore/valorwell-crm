-- Applied to Billing Hub as 20261009234553_crm_therapist_prospect_review_workflow.
-- CRM-only review layer for protected outreach staging, never a campaign sender.
-- The preceding migration already tenant-scoped the staging source.
CREATE UNIQUE INDEX IF NOT EXISTS therapist_outreach_prospects_tenant_id_id_key ON public.therapist_outreach_prospects(tenant_id,id);
CREATE TABLE IF NOT EXISTS public.crm_therapist_prospect_workflow (
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
 prospect_id uuid NOT NULL,
 owner_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
 workflow_status text NOT NULL DEFAULT 'review' CHECK (workflow_status IN ('review','ready','blocked')),
 next_action text CHECK (next_action IS NULL OR length(next_action)<=500),
 next_action_due_at timestamptz,
 notes text CHECK (notes IS NULL OR length(notes)<=4000),
 version integer NOT NULL DEFAULT 1 CHECK (version>0),
 updated_by uuid REFERENCES public.profiles(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id,prospect_id),
 CONSTRAINT crm_therapist_prospect_workflow_source_fk FOREIGN KEY (tenant_id,prospect_id)
 REFERENCES public.therapist_outreach_prospects(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS crm_therapist_prospect_workflow_owner_idx ON public.crm_therapist_prospect_workflow(tenant_id,owner_profile_id,workflow_status);
CREATE TABLE IF NOT EXISTS public.crm_therapist_prospect_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 tenant_id uuid NOT NULL,
 prospect_id uuid NOT NULL,
 actor_profile_id uuid NOT NULL REFERENCES public.profiles(id),
 old_status text,
 new_status text NOT NULL,
 old_owner_profile_id uuid,
 new_owner_profile_id uuid,
 reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 8 AND 500),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (tenant_id,prospect_id)
 REFERENCES public.crm_therapist_prospect_workflow(tenant_id,prospect_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS crm_therapist_prospect_events_record_idx ON public.crm_therapist_prospect_events(tenant_id,prospect_id,created_at DESC);
ALTER TABLE public.crm_therapist_prospect_workflow ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_therapist_prospect_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crm_therapist_prospect_workflow FROM PUBLIC,anon,authenticated;
REVOKE ALL ON TABLE public.crm_therapist_prospect_events FROM PUBLIC,anon,authenticated;

-- One-time ownership backfill explicitly requested for Lucas Predmore.
-- These values are NOT defaults for future tenants or prospects.
INSERT INTO public.crm_therapist_prospect_workflow (tenant_id,prospect_id,owner_profile_id,workflow_status)
SELECT tenant_id,id,'d2dc0624-1e71-49d6-8b04-76cf1e822074'::uuid,
 CASE WHEN NOT outreach_contactable OR outreach_exclusion_reason IS NOT NULL THEN 'blocked' ELSE 'review' END
FROM public.therapist_outreach_prospects
WHERE tenant_id='00000000-0000-0000-0000-000000000001'::uuid
ON CONFLICT (tenant_id,prospect_id) DO NOTHING;

DO $setup$
DECLARE v_pipeline uuid:='197bfeb7-a1d2-4c26-842f-045b5256d9e4';
DECLARE v_tenant uuid:='00000000-0000-0000-0000-000000000001';
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.crm_pipelines WHERE id=v_pipeline AND tenant_id=v_tenant AND source_key='provider_applicants') THEN
  RAISE EXCEPTION 'Expected clinician pipeline not found for ValorWell';
 END IF;
 INSERT INTO public.crm_pipeline_stages
 (tenant_id,pipeline_id,name,position,is_terminal,source_stage_key)
 SELECT v_tenant,v_pipeline,v.name,v.position,false,v.key
 FROM (VALUES
 ('Prospects — Review',6,'outreach_review'),
 ('Prospects — Ready',7,'outreach_ready'),
 ('Prospects — Blocked',8,'outreach_blocked')
 ) AS v(name,position,key)
 WHERE NOT EXISTS(SELECT 1 FROM public.crm_pipeline_stages s WHERE s.pipeline_id=v_pipeline AND s.source_stage_key=v.key);
END $setup$;

CREATE OR REPLACE FUNCTION public.crm_list_therapist_prospects(p_tenant_id uuid, p_page integer DEFAULT 1, p_page_size integer DEFAULT 200, p_search text DEFAULT NULL::text, p_prospect_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_result jsonb;
DECLARE v_page integer := greatest(1,least(coalesce(p_page,1),1000));
DECLARE v_size integer := greatest(1,least(coalesce(p_page_size,200),200));
DECLARE v_search text := left(lower(btrim(coalesce(p_search,''))),120);
BEGIN
 IF (select auth.uid()) IS NULL
  OR NOT coalesce(private.crm_has_relationship_permission(auth.uid(),p_tenant_id,'view_relationships'),false)
  OR public.crm_staff_tenant_for_applicant_pipeline() IS DISTINCT FROM p_tenant_id
 THEN RAISE EXCEPTION 'CRM therapist prospect access denied' USING ERRCODE='42501'; END IF;
 WITH matches AS MATERIALIZED (
  SELECT p.id,p.tenant_id,p.first_name,p.last_name,p.email,p.phone,
   p.linkedin_profile,p.license_type,p.state,p.licensed_states,
   p.outreach_contactable,p.outreach_exclusion_reason,
   p.created_at,p.updated_at,
   coalesce(w.owner_profile_id,NULL::uuid) AS owner_profile_id,
   coalesce(w.next_action,NULL::text) AS next_action,
   w.next_action_due_at,w.notes,coalesce(w.version,0) AS version,
   CASE WHEN NOT p.outreach_contactable OR p.outreach_exclusion_reason IS NOT NULL THEN 'blocked'
        ELSE coalesce(w.workflow_status,'review') END AS workflow_status
  FROM public.therapist_outreach_prospects p
  LEFT JOIN public.crm_therapist_prospect_workflow w
    ON w.tenant_id=p.tenant_id AND w.prospect_id=p.id
  WHERE p.tenant_id=p_tenant_id
    AND (p_prospect_id IS NULL OR p.id=p_prospect_id)
    AND (v_search='' OR strpos(lower(coalesce(p.first_name,'')),v_search)>0
     OR strpos(lower(coalesce(p.last_name,'')),v_search)>0
     OR strpos(lower(coalesce(p.email,'')),v_search)>0
     OR strpos(lower(coalesce(p.license_type,'')),v_search)>0
     OR strpos(lower(coalesce(p.state,'')),v_search)>0)
 ), page_rows AS (
  SELECT * FROM matches ORDER BY created_at DESC,id DESC
  LIMIT v_size OFFSET (v_page-1)*v_size
 )
 SELECT jsonb_build_object(
  'total',(SELECT count(*) FROM matches),
  'page',v_page,
  'pageSize',v_size,
  'items',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'id',id,'firstName',first_name,'lastName',last_name,
   'email',email,'phone',phone,'linkedIn',linkedin_profile,
   'licenseType',license_type,'state',state,'licensedStates',licensed_states,
   'contactable',outreach_contactable,'exclusionReason',outreach_exclusion_reason,
   'ownerProfileId',owner_profile_id,'nextAction',next_action,
   'nextActionDueAt',next_action_due_at,'notes',notes,'version',version,
   'status',workflow_status,'createdAt',created_at,'updatedAt',updated_at
  ) ORDER BY created_at DESC,id DESC) FROM page_rows),'[]'::jsonb)
 ) INTO v_result;
 RETURN v_result;
END $function$
;

CREATE OR REPLACE FUNCTION public.crm_therapist_prospect_history(p_tenant_id uuid, p_prospect_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_history jsonb;
BEGIN
 IF (select auth.uid()) IS NULL
  OR NOT coalesce(private.crm_has_relationship_permission(auth.uid(),p_tenant_id,'view_relationships'),false)
  OR public.crm_staff_tenant_for_applicant_pipeline() IS DISTINCT FROM p_tenant_id
 THEN RAISE EXCEPTION 'CRM therapist prospect history denied' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
 'when',e.created_at,'actor',e.actor_profile_id,'from',e.old_status,
 'to',e.new_status,'owner',e.new_owner_profile_id,'reason',e.reason
 ) ORDER BY e.created_at DESC),'[]'::jsonb) INTO v_history
 FROM (SELECT * FROM public.crm_therapist_prospect_events
  WHERE tenant_id=p_tenant_id AND prospect_id=p_prospect_id
  ORDER BY created_at DESC,id DESC LIMIT 100) e;
 RETURN v_history;
END $function$
;

CREATE OR REPLACE FUNCTION public.crm_update_therapist_prospect(p_tenant_id uuid, p_prospect_id uuid, p_expected_version integer, p_owner_profile_id uuid, p_status text, p_next_action text, p_next_action_due_at timestamp with time zone, p_notes text, p_reason text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_actor uuid := (select auth.uid());
DECLARE v_source public.therapist_outreach_prospects%ROWTYPE;
DECLARE v_old public.crm_therapist_prospect_workflow%ROWTYPE;
DECLARE v_version integer;
BEGIN
 IF v_actor IS NULL
  OR NOT coalesce(private.crm_has_relationship_permission(v_actor,p_tenant_id,'edit_relationships'),false)
  OR public.crm_staff_tenant_for_applicant_pipeline() IS DISTINCT FROM p_tenant_id
 THEN RAISE EXCEPTION 'CRM therapist prospect edit denied' USING ERRCODE='42501'; END IF;
 IF p_status NOT IN ('review','ready','blocked') OR p_status IS NULL
  OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 8 AND 500
  OR length(coalesce(p_next_action,''))>500 OR length(coalesce(p_notes,''))>4000
 THEN RAISE EXCEPTION 'Invalid stage, reason, note or follow-up'; END IF;
 IF p_owner_profile_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM public.crm_user_capabilities c
  WHERE c.tenant_id=p_tenant_id AND c.profile_id=p_owner_profile_id
    AND c.crm_role::text IN ('crm_admin','crm_operator')
 ) THEN RAISE EXCEPTION 'Owner must be an authorized member of this CRM tenant'; END IF;
 SELECT * INTO v_source FROM public.therapist_outreach_prospects
 WHERE id=p_prospect_id AND tenant_id=p_tenant_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Prospect not found in tenant' USING ERRCODE='42501'; END IF;
 IF p_status='ready' AND
    (NOT v_source.outreach_contactable OR v_source.outreach_exclusion_reason IS NOT NULL)
 THEN RAISE EXCEPTION 'Suppressed prospect cannot be marked ready'; END IF;
 SELECT * INTO v_old FROM public.crm_therapist_prospect_workflow
 WHERE tenant_id=p_tenant_id AND prospect_id=p_prospect_id FOR UPDATE;
 IF NOT FOUND THEN
  IF p_expected_version<>0 THEN RAISE EXCEPTION 'Prospect changed: reload before editing'; END IF;
  INSERT INTO public.crm_therapist_prospect_workflow
   (tenant_id,prospect_id,owner_profile_id,workflow_status,next_action,next_action_due_at,notes,version,updated_by)
  VALUES (p_tenant_id,p_prospect_id,p_owner_profile_id,p_status,
   nullif(btrim(p_next_action),''),p_next_action_due_at,nullif(btrim(p_notes),''),1,v_actor);
  v_version:=1;
 ELSE
  IF v_old.version<>p_expected_version THEN
   RAISE EXCEPTION 'Prospect changed: reload before editing';
  END IF;
  UPDATE public.crm_therapist_prospect_workflow SET
   owner_profile_id=p_owner_profile_id, workflow_status=p_status,
   next_action=nullif(btrim(p_next_action),''),
   next_action_due_at=p_next_action_due_at, notes=nullif(btrim(p_notes),''),
   version=version+1,updated_by=v_actor,updated_at=now()
  WHERE tenant_id=p_tenant_id AND prospect_id=p_prospect_id
  RETURNING version INTO v_version;
 END IF;
 INSERT INTO public.crm_therapist_prospect_events
 (tenant_id,prospect_id,actor_profile_id,old_status,new_status,old_owner_profile_id,new_owner_profile_id,reason)
 VALUES (p_tenant_id,p_prospect_id,v_actor,v_old.workflow_status,p_status,
   v_old.owner_profile_id,p_owner_profile_id,btrim(p_reason));
 RETURN v_version;
END $function$
;

REVOKE ALL ON FUNCTION public.crm_list_therapist_prospects(uuid,integer,integer,text,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.crm_update_therapist_prospect(uuid,uuid,integer,uuid,text,text,timestamptz,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.crm_therapist_prospect_history(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_list_therapist_prospects(uuid,integer,integer,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_update_therapist_prospect(uuid,uuid,integer,uuid,text,text,timestamptz,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_therapist_prospect_history(uuid,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
