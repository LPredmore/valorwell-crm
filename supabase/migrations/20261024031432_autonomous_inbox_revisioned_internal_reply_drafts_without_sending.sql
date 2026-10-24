-- M3 CRM-only unsent drafts, immutable revisions and optimistic concurrency.
CREATE TABLE IF NOT EXISTS private.autonomous_inbox_draft_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,case_id uuid NOT NULL,
 revision integer NOT NULL CHECK(revision>0),
 body_plaintext text NOT NULL CHECK(length(body_plaintext) BETWEEN 1 AND 12000 AND length(btrim(body_plaintext))>0),
 created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,case_id,revision),
 FOREIGN KEY(tenant_id,case_id) REFERENCES public.valorwell_hourly_comms_review_cases(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS vw_autonomous_draft_case_revision_idx
 ON private.autonomous_inbox_draft_revisions(tenant_id,case_id,revision DESC);
ALTER TABLE private.autonomous_inbox_draft_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.autonomous_inbox_draft_revisions FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON private.autonomous_inbox_draft_revisions TO service_role;
CREATE OR REPLACE FUNCTION public.crm_autonomous_inbox_drafts_v1(p_case_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_case public.valorwell_hourly_comms_review_cases%rowtype;v_latest record;v_history jsonb;
BEGIN
 IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_case FROM public.valorwell_hourly_comms_review_cases WHERE id=p_case_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unknown case' USING ERRCODE='P0002'; END IF;
 IF NOT coalesce(private.crm_has_relationship_permission((SELECT auth.uid()),v_case.tenant_id,'view_relationships'),false)
 THEN RAISE EXCEPTION 'CRM draft access denied' USING ERRCODE='42501'; END IF;
 SELECT id,revision,body_plaintext,created_by,created_at INTO v_latest
 FROM private.autonomous_inbox_draft_revisions
 WHERE tenant_id=v_case.tenant_id AND case_id=v_case.id ORDER BY revision DESC LIMIT 1;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'revision',h.revision,'createdAt',h.created_at,'createdBy',h.created_by) ORDER BY h.revision DESC),'[]'::jsonb)
 INTO v_history
 FROM (SELECT revision,created_at,created_by
       FROM private.autonomous_inbox_draft_revisions
       WHERE tenant_id=v_case.tenant_id AND case_id=v_case.id
       ORDER BY revision DESC LIMIT 10) h;
 RETURN jsonb_build_object(
 'caseId',v_case.id,'caseState',v_case.state,
 'latestRevision',coalesce(v_latest.revision,0),
 'body',coalesce(v_latest.body_plaintext,''),
 'savedAt',v_latest.created_at,
 'history',v_history,'deliveryState','not_sent');
END;
$function$;

REVOKE ALL ON FUNCTION public.crm_autonomous_inbox_drafts_v1(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_autonomous_inbox_drafts_v1(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.crm_autonomous_inbox_save_draft_v1(p_case_id uuid, p_body text, p_expected_revision integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_case public.valorwell_hourly_comms_review_cases%rowtype;
 v_actor uuid;v_revision integer;v_inserted uuid;
BEGIN
 v_actor:=(SELECT auth.uid());
 IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 IF p_body IS NULL OR length(btrim(p_body))=0 OR length(p_body)>12000
 THEN RAISE EXCEPTION 'Draft must be 1–12,000 nonblank characters' USING ERRCODE='22023'; END IF;
 IF p_expected_revision IS NULL OR p_expected_revision<0
 THEN RAISE EXCEPTION 'Invalid expected revision' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_case FROM public.valorwell_hourly_comms_review_cases
 WHERE id=p_case_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unknown case' USING ERRCODE='P0002'; END IF;
 IF NOT coalesce(private.crm_has_relationship_permission(v_actor,v_case.tenant_id,'edit_relationships'),false)
 THEN RAISE EXCEPTION 'CRM draft editing denied' USING ERRCODE='42501'; END IF;
 IF v_case.state<>'pending_review'
 THEN RAISE EXCEPTION 'Closed cases cannot be edited' USING ERRCODE='23514'; END IF;
 SELECT coalesce(max(revision),0) INTO v_revision
 FROM private.autonomous_inbox_draft_revisions
 WHERE tenant_id=v_case.tenant_id AND case_id=v_case.id;
 IF v_revision<>p_expected_revision
 THEN RAISE EXCEPTION 'Draft has changed; refresh before saving' USING ERRCODE='40001'; END IF;
 INSERT INTO private.autonomous_inbox_draft_revisions
 (tenant_id,case_id,revision,body_plaintext,created_by)
 VALUES(v_case.tenant_id,v_case.id,v_revision+1,p_body,v_actor)
 RETURNING id INTO v_inserted;
 INSERT INTO private.autonomous_inbox_case_events
  (tenant_id,case_id,event_key,event_kind,actor_profile_id,evidence)
 VALUES(v_case.tenant_id,v_case.id,'draft_saved:'||v_inserted::text,
  'reviewed',v_actor,jsonb_build_object('action','draft_saved','revision',v_revision+1,'messageSent',false));
 RETURN jsonb_build_object('caseId',v_case.id,'revision',v_revision+1,
 'deliveryState','not_sent','messageSent',false);
END;
$function$;

REVOKE ALL ON FUNCTION public.crm_autonomous_inbox_save_draft_v1(uuid,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_autonomous_inbox_save_draft_v1(uuid,text,integer) TO authenticated;
