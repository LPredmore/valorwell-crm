-- Associations widen the set of blockers; they do not verify message identity.
create or replace function private.relationship_review_group_dispositions(
 p_tenant uuid,p_group text,p_organization uuid
) returns table(issue_id uuid,finished boolean)
language sql stable security definer set search_path='' as $$
 select i.id, coalesce(
   (i.status='resolved' and tri.review_state='approved') or
   (i.status='ignored' and nullif(btrim(i.resolution),'') is not null
    and i.details#>>'{source_verification,provider}'=i.source
    and i.details#>>'{source_verification,provider_message_id}'=i.external_event_id
    and nullif(i.details#>>'{source_verification,verified_at_utc}','') is not null
    and nullif(i.details#>>'{source_verification,reason_kind}','') is not null),false) as finished
 from public.relationship_reconciliation_issues i
 left join private.relationship_email_issue_triage tri on tri.issue_id=i.id and tri.tenant_id=i.tenant_id
 left join public.relationship_opportunities op on op.id=i.opportunity_id and op.tenant_id=i.tenant_id
 where i.tenant_id=p_tenant and i.source in ('gmail','resend') and (
   tri.group_key=p_group or
   (p_organization is not null and (
     tri.candidate_organization_id=p_organization or op.organization_id=p_organization
     or i.details#>>'{next_review_20261022,thread_organization_id}'=p_organization::text
     or i.details#>>'{thread_organization_review_20261022,organization_id}'=p_organization::text
     or i.details#>>'{source_verification,verified_organization_id}'=p_organization::text
     or exists(select 1 from public.relationship_communications cm where cm.tenant_id=i.tenant_id
       and cm.organization_id=p_organization and (cm.id=tri.observed_communication_id
         or cm.id::text=i.details#>>'{provider_evidence_20261022,communication_id}'))
   ))
 );
$$;
revoke all on function private.relationship_review_group_dispositions(uuid,text,uuid) from public,anon,authenticated;

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
  v_tasks jsonb;
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

  -- Serialize against issue/triage inserts and disposition changes during apply.
  -- Authentication is checked before acquiring locks; ordinary task guards remain active.
  IF p_apply THEN
    LOCK TABLE public.relationship_reconciliation_issues,
      private.relationship_email_issue_triage,public.relationship_communications,
      public.relationship_opportunities IN SHARE MODE;
  END IF;

  SELECT count(*) FILTER(WHERE c.total_count>0 AND c.unfinished=0),
         count(*) FILTER(WHERE c.unfinished>0)
  INTO v_eligible,v_blocked
  FROM private.relationship_email_review_groups g
  JOIN public.crm_tasks t ON t.id=g.task_id AND t.tenant_id=g.tenant_id
  CROSS JOIN LATERAL (
    SELECT count(*) AS total_count, count(*) FILTER(WHERE NOT finished) AS unfinished
    FROM private.relationship_review_group_dispositions(g.tenant_id,g.group_key,g.organization_id)
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
    SELECT coalesce(jsonb_agg(jsonb_build_object('taskId',t.id,'title',t.title) ORDER BY t.id),'[]'::jsonb)
    INTO v_tasks
    FROM private.relationship_email_review_groups g
    JOIN public.crm_tasks t ON t.id=g.task_id AND t.tenant_id=g.tenant_id
    WHERE g.tenant_id=v_tenant AND t.status='not_started'
      AND t.title LIKE 'Review BTY email associations · %'
      AND t.relationship_organization_id=g.organization_id AND t.owner_id=g.owner_profile_id
      AND t.relationship_contact_id IS NULL AND t.relationship_opportunity_id IS NULL
      AND t.client_id IS NULL AND t.staff_id IS NULL AND t.campaign_id IS NULL AND t.exception_id IS NULL
      AND EXISTS(select 1 from private.relationship_review_group_dispositions(g.tenant_id,g.group_key,g.organization_id))
      AND NOT EXISTS(select 1 from private.relationship_review_group_dispositions(g.tenant_id,g.group_key,g.organization_id) where not finished);
    RETURN jsonb_build_object('eligible',v_eligible,'blocked',v_blocked,
      'completed',0,'dryRun',true,'tasks',v_tasks);
  END IF;

  -- A short bounded, idempotent transaction. CRM's task-update trigger
  -- checks auth.uid() and the same tenant/relationship permission again.
  FOR v_group IN
    SELECT g.group_key,g.task_id,g.organization_id
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
    SELECT count(*),count(*) FILTER(WHERE NOT finished)
    INTO v_total,v_unfinished
    FROM private.relationship_review_group_dispositions(v_tenant,v_group.group_key,v_group.organization_id);

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

-- Preserve completed historical links when a new open issue creates another task.
create or replace function public.link_relationship_email_review_task(
 p_group_key text,
 p_task_id uuid
) returns jsonb
language plpgsql security definer set search_path=''
as $fn$
declare
 v_context jsonb:=private.relationship_orchestration_context(true);
 v_tenant uuid:=(v_context->>'tenant_id')::uuid;
 v_actor uuid:=(v_context->>'actor_id')::uuid;
 v_group private.relationship_email_review_groups%rowtype;
 v_task public.crm_tasks%rowtype;
begin
 if p_group_key is null or length(p_group_key)>180 then
   raise exception 'Invalid email review group.' using errcode='22023';
 end if;
 select * into v_group from private.relationship_email_review_groups
 where tenant_id=v_tenant and group_key=p_group_key for update;
 if not found then raise exception 'Email review group not found.' using errcode='P0002'; end if;
 select * into v_task from public.crm_tasks where id=p_task_id and tenant_id=v_tenant;
 if not found then raise exception 'CRM review task does not exist.' using errcode='P0002'; end if;
 if v_task.created_by_profile_id<>v_actor
   or v_task.relationship_organization_id is distinct from v_group.organization_id
   or v_task.client_id is not null or v_task.staff_id is not null
   or v_task.campaign_id is not null or v_task.exception_id is not null then
   raise exception 'Review task must be created by the current operator for the same non-clinical organization.' using errcode='42501';
 end if;
 if v_group.task_id is not null and v_group.task_id<>p_task_id then
   raise exception 'The review group already has a different task.' using errcode='23505';
 end if;
 update private.relationship_email_review_groups set task_id=p_task_id,updated_at=now()
 where tenant_id=v_tenant and group_key=p_group_key;
 update private.relationship_email_issue_triage set review_task_id=p_task_id,updated_at=now()
 where tenant_id=v_tenant and group_key=p_group_key and review_state='needs_review' and review_task_id is null
   and exists(select 1 from public.relationship_reconciliation_issues i where i.id=issue_id and i.tenant_id=v_tenant and i.status='open');
 return jsonb_build_object('groupKey',p_group_key,'taskId',p_task_id);
end;
$fn$;