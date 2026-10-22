-- Owner-only routing for non-clinical email review groups, no identity inference.
ALTER TABLE private.relationship_email_review_groups
 ADD COLUMN IF NOT EXISTS owner_profile_id uuid;
CREATE OR REPLACE FUNCTION private.set_relationship_email_review_group_owner_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $owner$
BEGIN
  IF NEW.owner_profile_id IS NULL AND NEW.organization_id IS NOT NULL THEN
    SELECT o.owner_profile_id INTO NEW.owner_profile_id
    FROM public.relationship_organizations o
    JOIN public.tenant_memberships member
      ON member.tenant_id=o.tenant_id AND member.profile_id=o.owner_profile_id
    WHERE o.tenant_id=NEW.tenant_id AND o.id=NEW.organization_id;
  END IF;
  RETURN NEW;
END;
$owner$;
REVOKE ALL ON FUNCTION private.set_relationship_email_review_group_owner_v1()
 FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS relationship_email_review_group_owner_v1
 ON private.relationship_email_review_groups;
CREATE TRIGGER relationship_email_review_group_owner_v1
BEFORE INSERT OR UPDATE OF organization_id,owner_profile_id
ON private.relationship_email_review_groups
FOR EACH ROW EXECUTE FUNCTION private.set_relationship_email_review_group_owner_v1();

-- Existing 68 linked organization owners are current tenant members.
-- Leave the three organization-unknown groups unowned for identity review.
UPDATE private.relationship_email_review_groups g
SET owner_profile_id=o.owner_profile_id, updated_at=now()
FROM public.relationship_organizations o
JOIN public.tenant_memberships member
  ON member.tenant_id=o.tenant_id AND member.profile_id=o.owner_profile_id
WHERE g.tenant_id=o.tenant_id AND g.organization_id=o.id
 AND g.owner_profile_id IS NULL AND o.owner_profile_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.list_relationship_email_review_queue(p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_context jsonb:=private.relationship_orchestration_context(false);
 v_tenant uuid:=(v_context->>'tenant_id')::uuid;
 v_groups jsonb;
 v_counts jsonb;
begin
 if p_limit not between 1 and 200 then
   raise exception 'Invalid review queue limit.' using errcode='22023';
 end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'groupKey',q.group_key,
  'organizationId',q.organization_id,
  'organizationName',q.org_name,
  'issueCount',q.issue_count,
  'reviewTaskId',q.task_id,
  'ownerProfileId',q.owner_profile_id,
  'ownerReviewRequired',q.owner_profile_id is null,
  'candidateOpportunityCount',q.candidate_opportunities,
  'sourceSummary',q.sources,
  'classifications',q.classifications
 ) order by q.issue_count desc,q.group_key),'[]'::jsonb)
 into v_groups from (
  select g.group_key,g.organization_id,org.name org_name,g.task_id,g.owner_profile_id,
     count(t.issue_id) issue_count,
     count(distinct t.candidate_opportunity_id) candidate_opportunities,
     jsonb_object_agg(distinct t.source, 1) sources,
     array_agg(distinct t.classification order by t.classification) classifications
  from private.relationship_email_review_groups g
  join private.relationship_email_issue_triage t on t.tenant_id=g.tenant_id and t.group_key=g.group_key
    and t.review_state='needs_review'
  join public.relationship_reconciliation_issues i on i.id=t.issue_id and i.status='open'
  left join public.relationship_organizations org on org.tenant_id=g.tenant_id and org.id=g.organization_id
  where g.tenant_id=v_tenant
  group by g.group_key,g.organization_id,org.name,g.task_id,g.owner_profile_id
  order by count(t.issue_id) desc,g.group_key
  limit p_limit
 ) q;
 select jsonb_build_object(
  'openIssues',count(*),
  'candidateOpportunities',count(*) filter(where candidate_opportunity_id is not null),
  'existingCommunications',count(*) filter(where observed_communication_id is not null),
  'awaitingReview',count(*) filter(where review_state='needs_review'),
  'unownedGroups', (select count(*) from private.relationship_email_review_groups g
    where g.tenant_id=v_tenant and g.owner_profile_id is null)
 ) into v_counts
 from private.relationship_email_issue_triage t
 join public.relationship_reconciliation_issues i on i.id=t.issue_id
 where t.tenant_id=v_tenant and i.status='open';
 return jsonb_build_object('summary',coalesce(v_counts,'{}'::jsonb),'groups',v_groups);
end;
$function$;

REVOKE ALL ON FUNCTION public.list_relationship_email_review_queue(integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_relationship_email_review_queue(integer) TO authenticated,service_role;
