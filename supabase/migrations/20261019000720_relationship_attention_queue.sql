-- A global relationship-attention worklist over existing opportunities, not
-- a parallel table of email threads or an invented independent case lifecycle.
CREATE OR REPLACE FUNCTION public.list_relationship_attention_queue(p_limit integer DEFAULT 40)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE
 v_context jsonb:=private.relationship_orchestration_context(false);
 v_tenant uuid:=(v_context->>'tenant_id')::uuid;
 v_result jsonb;
BEGIN
 IF p_limit NOT BETWEEN 1 AND 100 THEN
   RAISE EXCEPTION 'Invalid relationship attention limit.' USING ERRCODE='22023';
 END IF;
 WITH evidence AS (
   SELECT op.id,op.organization_id,org.name organization_name,
     op.status pipeline_status,op.owner_profile_id,op.next_action,
     op.next_action_due_at,op.attention_status,op.attention_note,
     op.attention_assessed_through_at,
     (SELECT max(c.occurred_at) FROM public.relationship_communications c
       WHERE c.tenant_id=v_tenant AND c.opportunity_id=op.id AND c.direction='inbound') last_inbound_at,
     (SELECT count(*) FROM public.crm_tasks t
       WHERE t.tenant_id=v_tenant AND t.relationship_opportunity_id=op.id
         AND t.status IN ('not_started','in_progress','waiting','blocked')
     ) open_task_count,
     (SELECT count(*) FROM public.crm_tasks t
       WHERE t.tenant_id=v_tenant AND t.relationship_opportunity_id=op.id
         AND t.status IN ('not_started','in_progress','waiting','blocked')
         AND t.due_at <= now()
     ) overdue_task_count,
     (SELECT count(*) FROM private.relationship_email_issue_triage t
       JOIN public.relationship_reconciliation_issues i ON i.id=t.issue_id
       WHERE t.tenant_id=v_tenant AND t.candidate_opportunity_id=op.id
         AND t.review_state='needs_review' AND i.status='open'
     ) unresolved_issue_count
   FROM public.relationship_opportunities op
   JOIN public.relationship_organizations org
     ON org.tenant_id=op.tenant_id AND org.id=op.organization_id
   WHERE op.tenant_id=v_tenant
 ), evaluated AS (
   SELECT evidence.*,
   CASE
     WHEN attention_status='manual_review' THEN 'manual_review'
     WHEN attention_status IS NOT NULL AND last_inbound_at IS NOT NULL
       AND (attention_assessed_through_at IS NULL OR last_inbound_at > attention_assessed_through_at)
       THEN 'needs_action'
     WHEN overdue_task_count > 0 OR (next_action IS NOT NULL AND next_action_due_at <= now())
       THEN 'needs_action'
     WHEN attention_status IS NOT NULL THEN attention_status
     WHEN unresolved_issue_count > 0 THEN 'manual_review'
     WHEN next_action IS NOT NULL THEN 'needs_action'
     ELSE 'not_assessed'
   END effective_attention
   FROM evidence
 ), totals AS (
   SELECT count(*) opportunities,
     count(*) FILTER(WHERE effective_attention='needs_action') needs_action,
     count(*) FILTER(WHERE effective_attention='awaiting_approval') awaiting_approval,
     count(*) FILTER(WHERE effective_attention='manual_review') manual_review,
     count(*) FILTER(WHERE effective_attention='waiting_external') waiting_external,
     count(*) FILTER(WHERE effective_attention='clear') clear,
     count(*) FILTER(WHERE effective_attention='not_assessed') not_assessed
   FROM evaluated
 )
 SELECT jsonb_build_object(
   'summary',jsonb_build_object(
     'opportunities',totals.opportunities,
     'needsAction',totals.needs_action,
     'awaitingApproval',totals.awaiting_approval,
     'manualReview',totals.manual_review,
     'waitingExternal',totals.waiting_external,
     'clear',totals.clear,
     'notAssessed',totals.not_assessed
   ),
   'items',coalesce((
     SELECT jsonb_agg(jsonb_build_object(
       'id',q.id,'organizationId',q.organization_id,
       'organizationName',q.organization_name,'pipelineStatus',q.pipeline_status,
       'attentionStatus',q.effective_attention,'attentionNote',q.attention_note,
       'nextAction',q.next_action,'dueAt',q.next_action_due_at,
       'ownerId',q.owner_profile_id,'openTaskCount',q.open_task_count,
       'unresolvedIssueCount',q.unresolved_issue_count
     ) ORDER BY q.rank,q.next_action_due_at NULLS LAST,q.organization_name)
     FROM (
       SELECT e.*,
         CASE e.effective_attention
           WHEN 'awaiting_approval' THEN 0
           WHEN 'manual_review' THEN 1
           WHEN 'needs_action' THEN 2
           WHEN 'waiting_external' THEN 3
           ELSE 4
         END rank
       FROM evaluated e
       WHERE e.effective_attention IN ('awaiting_approval','manual_review','needs_action','waiting_external')
       ORDER BY rank,e.next_action_due_at NULLS LAST,e.organization_name
       LIMIT p_limit
     ) q
   ),'[]'::jsonb)
 ) INTO v_result FROM totals;
 RETURN v_result;
END;
$fn$;
REVOKE ALL ON FUNCTION public.list_relationship_attention_queue(integer) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.list_relationship_attention_queue(integer) TO authenticated;
