-- Secure, signed-in cleanup of completed non-clinical historical email review tasks.
-- No outbound messages, opportunity mutations, or clinical records.
CREATE OR REPLACE FUNCTION public.process_relationship_email_review_task_cleanup(
  p_apply boolean DEFAULT false,
  p_limit integer DEFAULT 100
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $cleanup$
DECLARE
  v_context jsonb;
  v_tenant uuid;
  v_actor uuid;
  v_eligible integer;
  v_blocked integer;
  v_completed integer:=0;
  v_total integer;
  v_unfinished integer;
  v_group record;
  v_changed integer;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid historical review cleanup limit.' USING ERRCODE='22023';
  END IF;
  v_context:=private.relationship_orchestration_context(true);
  v_tenant:=(v_context->>'tenant_id')::uuid;
  v_actor:=(v_context->>'actor_id')::uuid;
  IF v_actor IS NULL OR NOT private.crm_has_relationship_permission(v_actor,v_tenant,'edit_relationships') THEN
    RAISE EXCEPTION 'CRM relationship task editing permission required.' USING ERRCODE='42501';
  END IF;

  SELECT count(*) FILTER(WHERE c.total_count>0 AND c.unfinished=0),
         count(*) FILTER(WHERE c.unfinished>0)
  INTO v_eligible,v_blocked
  FROM private.relationship_email_review_groups g
  JOIN public.crm_tasks t ON t.id=g.task_id AND t.tenant_id=g.tenant_id
  CROSS JOIN LATERAL (
    SELECT count(*) AS total_count,
           count(*) FILTER (WHERE i.status NOT IN ('resolved','ignored')
                      OR tri.review_state NOT IN ('approved','rejected')) AS unfinished
    FROM private.relationship_email_issue_triage tri
    JOIN public.relationship_reconciliation_issues i
      ON i.id=tri.issue_id AND i.tenant_id=tri.tenant_id
    WHERE tri.tenant_id=g.tenant_id AND tri.group_key=g.group_key
  ) c
  WHERE g.tenant_id=v_tenant
    AND t.status='not_started'::public.crm_task_status_enum
    AND t.title LIKE 'Review BTY email associations · %'
    AND t.relationship_organization_id=g.organization_id
    AND t.owner_id=g.owner_profile_id
    AND t.relationship_contact_id IS NULL
    AND t.relationship_opportunity_id IS NULL
    AND t.client_id IS NULL AND t.staff_id IS NULL
    AND t.campaign_id IS NULL AND t.exception_id IS NULL;

  IF NOT p_apply THEN
    RETURN jsonb_build_object('eligible',v_eligible,'blocked',v_blocked,
      'completed',0,'dryRun',true);
  END IF;

  -- A short bounded, idempotent transaction. CRM's task-update trigger
  -- checks auth.uid() and the same tenant/relationship permission again.
  FOR v_group IN
    SELECT g.group_key,g.task_id
    FROM private.relationship_email_review_groups g
    JOIN public.crm_tasks t ON t.id=g.task_id AND t.tenant_id=g.tenant_id
    WHERE g.tenant_id=v_tenant
      AND t.status='not_started'::public.crm_task_status_enum
      AND t.title LIKE 'Review BTY email associations · %'
      AND t.relationship_organization_id=g.organization_id
      AND t.owner_id=g.owner_profile_id
      AND t.relationship_contact_id IS NULL
      AND t.relationship_opportunity_id IS NULL
      AND t.client_id IS NULL AND t.staff_id IS NULL
      AND t.campaign_id IS NULL AND t.exception_id IS NULL
    ORDER BY g.group_key
    LIMIT p_limit
    FOR UPDATE OF g,t
  LOOP
    -- Re-evaluate each group under lock. Never complete an unreviewed issue.
    SELECT count(*),
      count(*) FILTER(WHERE i.status NOT IN ('resolved','ignored')
           OR tri.review_state NOT IN ('approved','rejected'))
    INTO v_total,v_unfinished
    FROM private.relationship_email_issue_triage tri
    JOIN public.relationship_reconciliation_issues i
      ON i.id=tri.issue_id AND i.tenant_id=tri.tenant_id
    WHERE tri.tenant_id=v_tenant AND tri.group_key=v_group.group_key;

    IF v_total=0 OR v_unfinished>0 THEN CONTINUE; END IF;

    UPDATE public.crm_tasks
    SET status='completed'::public.crm_task_status_enum,
        completed_at=now(),updated_at=now(),
        description=concat_ws(E'\n\n',description,
          '[Historical email review completed: all group issues have source-backed final dispositions. '
          ||'This closes review work only; no RFC anchor, missing email body, or opportunity stage is inferred.]')
    WHERE tenant_id=v_tenant AND id=v_group.task_id
      AND status='not_started'::public.crm_task_status_enum;
    GET DIAGNOSTICS v_changed=ROW_COUNT;
    IF v_changed<>1 THEN
      RAISE EXCEPTION 'Review task changed during completion.' USING ERRCODE='40001';
    END IF;

    -- Keep triage.review_task_id immutable as historical evidence, while
    -- allowing a fresh authenticated task to link if new issues arrive.
    UPDATE private.relationship_email_review_groups
    SET task_id=NULL,issue_count=0,updated_at=now()
    WHERE tenant_id=v_tenant AND group_key=v_group.group_key
      AND task_id=v_group.task_id;
    GET DIAGNOSTICS v_changed=ROW_COUNT;
    IF v_changed<>1 THEN
      RAISE EXCEPTION 'Review group changed during completion.' USING ERRCODE='40001';
    END IF;
    v_completed:=v_completed+1;
  END LOOP;

  RETURN jsonb_build_object('eligibleBefore',v_eligible,'blockedBefore',v_blocked,
    'completed',v_completed,'dryRun',false);
END;
$cleanup$;

REVOKE ALL ON FUNCTION public.process_relationship_email_review_task_cleanup(boolean,integer)
 FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_relationship_email_review_task_cleanup(boolean,integer)
 TO authenticated;
