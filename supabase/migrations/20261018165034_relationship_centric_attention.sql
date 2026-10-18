-- Relationship-centric attention and opportunity-linked tasks.
-- A relationship's status/stage remains independent of operational attention.
ALTER TABLE public.relationship_opportunities
  ADD COLUMN IF NOT EXISTS attention_status text,
  ADD COLUMN IF NOT EXISTS attention_note text,
  ADD COLUMN IF NOT EXISTS attention_assessed_at timestamptz,
  ADD COLUMN IF NOT EXISTS attention_assessed_through_at timestamptz;
ALTER TABLE public.relationship_opportunities
  ADD CONSTRAINT relationship_opportunities_attention_status_check
  CHECK (attention_status IS NULL OR attention_status IN
    ('needs_action','awaiting_approval','waiting_external','manual_review','clear'));
ALTER TABLE public.crm_tasks ADD COLUMN IF NOT EXISTS relationship_opportunity_id uuid;
ALTER TABLE public.crm_tasks
  ADD CONSTRAINT crm_tasks_relationship_opportunity_tenant_fk
  FOREIGN KEY (tenant_id,relationship_opportunity_id)
  REFERENCES public.relationship_opportunities(tenant_id,id) ON DELETE RESTRICT;
ALTER TABLE public.crm_tasks DROP CONSTRAINT crm_tasks_clinical_relationship_exclusion;
ALTER TABLE public.crm_tasks
  ADD CONSTRAINT crm_tasks_clinical_relationship_exclusion
  CHECK (
    ((relationship_contact_id IS NULL AND relationship_organization_id IS NULL
       AND relationship_opportunity_id IS NULL)
    OR (client_id IS NULL AND staff_id IS NULL AND campaign_id IS NULL
       AND exception_id IS NULL))
    AND (relationship_opportunity_id IS NULL OR relationship_organization_id IS NOT NULL)
  );
CREATE INDEX IF NOT EXISTS crm_tasks_relationship_opportunity_due_idx
 ON public.crm_tasks(tenant_id,relationship_opportunity_id,due_at)
 WHERE relationship_opportunity_id IS NOT NULL;

-- Extend the current task guard, never weaken its existing auth and provenance rules.
CREATE OR REPLACE FUNCTION private.crm_validate_relationship_task_subject()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
BEGIN
 IF new.relationship_contact_id IS NULL AND new.relationship_organization_id IS NULL
    AND new.relationship_opportunity_id IS NULL THEN
   IF tg_op='UPDATE' AND
      (old.relationship_contact_id IS NOT NULL OR old.relationship_organization_id IS NOT NULL
       OR old.relationship_opportunity_id IS NOT NULL) THEN
     RAISE EXCEPTION 'Relationship subject links cannot be removed with a task update' USING ERRCODE='23514';
   END IF;
   RETURN new;
 END IF;
 IF (select auth.uid()) IS NULL OR
    NOT private.crm_has_relationship_permission((select auth.uid()),new.tenant_id,'edit_relationships') THEN
   RAISE EXCEPTION 'Relationship task mutation is not authorized' USING ERRCODE='42501';
 END IF;
 IF new.client_id IS NOT NULL OR new.staff_id IS NOT NULL
    OR new.campaign_id IS NOT NULL OR new.exception_id IS NOT NULL THEN
   RAISE EXCEPTION 'Relationship tasks cannot contain clinical or campaign source links' USING ERRCODE='23514';
 END IF;
 IF new.relationship_contact_id IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM public.relationship_contacts c
   WHERE c.id=new.relationship_contact_id AND c.tenant_id=new.tenant_id
 ) THEN
   RAISE EXCEPTION 'Contact subject does not belong to this tenant' USING ERRCODE='23514';
 END IF;
 IF new.relationship_organization_id IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM public.relationship_organizations o
   WHERE o.id=new.relationship_organization_id AND o.tenant_id=new.tenant_id
 ) THEN
   RAISE EXCEPTION 'Organization subject does not belong to this tenant' USING ERRCODE='23514';
 END IF;
 IF new.relationship_opportunity_id IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM public.relationship_opportunities o
   WHERE o.id=new.relationship_opportunity_id AND o.tenant_id=new.tenant_id
     AND o.organization_id=new.relationship_organization_id
 ) THEN
   RAISE EXCEPTION 'Opportunity subject does not match this organization and tenant' USING ERRCODE='23514';
 END IF;
 IF new.owner_id IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM public.tenant_memberships m
   WHERE m.profile_id=new.owner_id AND m.tenant_id=new.tenant_id
 ) THEN
   RAISE EXCEPTION 'Task owner does not belong to the operating tenant' USING ERRCODE='23514';
 END IF;
 IF tg_op='UPDATE' AND old.relationship_contact_id IS NULL
   AND old.relationship_organization_id IS NULL
   AND old.relationship_opportunity_id IS NULL THEN
   RAISE EXCEPTION 'An existing unrelated task cannot be converted to a relationship task' USING ERRCODE='23514';
 END IF;
 IF tg_op='UPDATE' AND (
   new.tenant_id IS DISTINCT FROM old.tenant_id OR
   new.client_id IS DISTINCT FROM old.client_id OR
   new.staff_id IS DISTINCT FROM old.staff_id OR
   new.campaign_id IS DISTINCT FROM old.campaign_id OR
   new.exception_id IS DISTINCT FROM old.exception_id OR
   new.created_by_profile_id IS DISTINCT FROM old.created_by_profile_id OR
   new.relationship_contact_id IS DISTINCT FROM old.relationship_contact_id OR
   new.relationship_organization_id IS DISTINCT FROM old.relationship_organization_id OR
   new.relationship_opportunity_id IS DISTINCT FROM old.relationship_opportunity_id
 ) THEN
   RAISE EXCEPTION 'Relationship task provenance is immutable' USING ERRCODE='23514';
 END IF;
 RETURN new;
END;
$fn$;

-- No new ledger: record an explicit operational decision directly on the
-- opportunity, at a known inbound-communication checkpoint.
CREATE OR REPLACE FUNCTION public.set_relationship_opportunity_attention(
 p_opportunity_id uuid,
 p_attention_status text,
 p_note text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE
 v_context jsonb:=private.relationship_orchestration_context(true);
 v_tenant uuid:=(v_context->>'tenant_id')::uuid;
 v_actor uuid:=(v_context->>'actor_id')::uuid;
 v_op public.relationship_opportunities%rowtype;
 v_checkpoint timestamptz;
BEGIN
 IF p_attention_status IS NULL OR
   p_attention_status NOT IN ('needs_action','awaiting_approval','waiting_external','manual_review','clear') THEN
   RAISE EXCEPTION 'Unsupported attention status.' USING ERRCODE='22023';
 END IF;
 IF p_note IS NULL OR length(btrim(p_note))<8 OR length(p_note)>2500 THEN
   RAISE EXCEPTION 'Explain the relationship-level decision (8–2500 characters).' USING ERRCODE='22023';
 END IF;
 SELECT * INTO v_op FROM public.relationship_opportunities
 WHERE id=p_opportunity_id AND tenant_id=v_tenant FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Opportunity unavailable in operating tenant.' USING ERRCODE='P0002'; END IF;
 IF p_attention_status='clear' AND (
   v_op.next_action IS NOT NULL
   OR EXISTS (
     SELECT 1 FROM public.crm_tasks t WHERE t.tenant_id=v_tenant
      AND t.relationship_opportunity_id=v_op.id
      AND t.status IN ('not_started','in_progress','waiting','blocked')
   )
   OR EXISTS(
     SELECT 1 FROM private.relationship_email_issue_triage t
     JOIN public.relationship_reconciliation_issues i ON i.id=t.issue_id
     WHERE t.tenant_id=v_tenant AND t.candidate_opportunity_id=v_op.id
       AND i.status='open' AND t.review_state='needs_review'
   )
 ) THEN
   RAISE EXCEPTION 'Unresolved opportunity work must be completed before marking clear.' USING ERRCODE='23514';
 END IF;
 SELECT max(occurred_at) INTO v_checkpoint
 FROM public.relationship_communications
 WHERE tenant_id=v_tenant AND opportunity_id=v_op.id AND direction='inbound';
 UPDATE public.relationship_opportunities SET
   attention_status=p_attention_status,
   attention_note=btrim(p_note),
   attention_assessed_at=now(),
   attention_assessed_through_at=v_checkpoint,
   updated_by_profile_id=v_actor,
   updated_at=now(),
   version=version+1
 WHERE id=v_op.id AND tenant_id=v_tenant;
 RETURN jsonb_build_object(
   'opportunityId',v_op.id,'attentionStatus',p_attention_status,
   'assessedThrough',v_checkpoint,'updatedAt',now()
 );
END;
$fn$;
REVOKE ALL ON FUNCTION public.set_relationship_opportunity_attention(uuid,text,text)
 FROM public,anon;
GRANT EXECUTE ON FUNCTION public.set_relationship_opportunity_attention(uuid,text,text)
 TO authenticated;

-- Aggregate one relationship from existing opportunities, communications,
-- tasks, and reconciliation evidence. Never expose message content or clinical data.
CREATE OR REPLACE FUNCTION public.get_relationship_attention_overview(p_organization_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE
 v_context jsonb:=private.relationship_orchestration_context(false);
 v_tenant uuid:=(v_context->>'tenant_id')::uuid;
 v_result jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.relationship_organizations
   WHERE id=p_organization_id AND tenant_id=v_tenant) THEN
   RAISE EXCEPTION 'Organization unavailable in operating tenant.' USING ERRCODE='P0002';
 END IF;
 WITH opportunity_data AS (
   SELECT op.id,op.status pipeline_status,op.owner_profile_id,
     op.primary_contact_id,op.next_action,op.next_action_due_at,
     op.attention_status,op.attention_note,op.attention_assessed_at,
     op.attention_assessed_through_at,
     (SELECT max(c.occurred_at) FROM public.relationship_communications c
      WHERE c.tenant_id=v_tenant AND c.opportunity_id=op.id AND c.direction='inbound') last_inbound_at,
     (SELECT count(*) FROM public.crm_tasks t
      WHERE t.tenant_id=v_tenant AND t.relationship_opportunity_id=op.id
        AND t.status IN('not_started','in_progress','waiting','blocked')) open_task_count,
     (SELECT count(*) FROM public.crm_tasks t
      WHERE t.tenant_id=v_tenant AND t.relationship_opportunity_id=op.id
        AND t.status IN('not_started','in_progress','waiting','blocked')
        AND t.due_at <= now()) overdue_task_count,
     (SELECT count(*) FROM private.relationship_email_issue_triage t
      JOIN public.relationship_reconciliation_issues i ON i.id=t.issue_id
      WHERE t.tenant_id=v_tenant AND t.candidate_opportunity_id=op.id
        AND t.review_state='needs_review' AND i.status='open') unresolved_issue_count
   FROM public.relationship_opportunities op
   WHERE op.tenant_id=v_tenant AND op.organization_id=p_organization_id
 ), evaluated AS (
   SELECT d.*,
     CASE
       WHEN d.attention_status='manual_review' THEN 'manual_review'
       WHEN d.attention_status IS NOT NULL AND d.last_inbound_at IS NOT NULL
         AND (d.attention_assessed_through_at IS NULL OR d.last_inbound_at>d.attention_assessed_through_at)
         THEN 'needs_action'
       WHEN d.overdue_task_count>0 OR
          (d.next_action IS NOT NULL AND d.next_action_due_at <= now())
         THEN 'needs_action'
       WHEN d.attention_status IS NOT NULL THEN d.attention_status
       WHEN d.unresolved_issue_count>0 THEN 'manual_review'
       WHEN d.next_action IS NOT NULL THEN 'needs_action'
       ELSE 'not_assessed'
     END effective_status
   FROM opportunity_data d
 ), issue_totals AS (
   SELECT count(*) unassociated_issue_count
   FROM private.relationship_email_issue_triage t
   JOIN public.relationship_reconciliation_issues i ON i.id=t.issue_id
   WHERE t.tenant_id=v_tenant AND t.candidate_organization_id=p_organization_id
     AND t.candidate_opportunity_id IS NULL AND i.status='open'
 ), task_totals AS (
   SELECT count(*) open_organization_tasks
   FROM public.crm_tasks t
   WHERE t.tenant_id=v_tenant AND t.relationship_organization_id=p_organization_id
     AND t.relationship_opportunity_id IS NULL
     AND t.status IN ('not_started','in_progress','waiting','blocked')
 ), totals AS (
   SELECT count(*) opportunities,
     count(*) FILTER(WHERE effective_status='needs_action') needs_action,
     count(*) FILTER(WHERE effective_status='awaiting_approval') awaiting_approval,
     count(*) FILTER(WHERE effective_status='manual_review') manual_review,
     count(*) FILTER(WHERE effective_status='waiting_external') waiting_external,
     count(*) FILTER(WHERE effective_status='clear') clear,
     count(*) FILTER(WHERE effective_status='not_assessed') not_assessed
   FROM evaluated
 )
 SELECT jsonb_build_object(
   'organizationId',p_organization_id,
   'summary',jsonb_build_object(
     'opportunities',totals.opportunities,
     'needsAction',totals.needs_action,
     'awaitingApproval',totals.awaiting_approval,
     'manualReview',totals.manual_review,
     'waitingExternal',totals.waiting_external,
     'clear',totals.clear,
     'notAssessed',totals.not_assessed,
     'unassociatedIssues',issue_totals.unassociated_issue_count,
     'openOrganizationTasks',task_totals.open_organization_tasks
   ),
   'opportunities',coalesce((
     SELECT jsonb_agg(jsonb_build_object(
       'id',e.id,'pipelineStatus',e.pipeline_status,
       'effectiveAttention',e.effective_status,'explicitAttention',e.attention_status,
       'attentionNote',e.attention_note,'lastAssessedAt',e.attention_assessed_at,
       'lastInboundAt',e.last_inbound_at,'nextAction',e.next_action,
       'nextActionDueAt',e.next_action_due_at,'ownerId',e.owner_profile_id,
       'openTaskCount',e.open_task_count,'unresolvedIssueCount',e.unresolved_issue_count
     ) ORDER BY e.next_action_due_at NULLS LAST,e.id)
     FROM evaluated e
   ),'[]'::jsonb)
 ) INTO v_result
 FROM totals CROSS JOIN issue_totals CROSS JOIN task_totals;
 RETURN v_result;
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_relationship_attention_overview(uuid) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.get_relationship_attention_overview(uuid) TO authenticated;
