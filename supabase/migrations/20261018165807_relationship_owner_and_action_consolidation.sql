-- One authoritative operational next action per opportunity; keep independently
-- authored organization/contact actions and archive only exact duplicates.
DO $fn$
DECLARE
 v_tenant uuid:='00000000-0000-0000-0000-000000000001'::uuid;
 v_owner uuid:='d2dc0624-1e71-49d6-8b04-76cf1e822074'::uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.tenant_memberships
               WHERE tenant_id=v_tenant AND profile_id=v_owner) THEN
   RAISE EXCEPTION 'CRM default owner is not a member of the tenant';
 END IF;

 -- The already-established CRM owner is preserved; only unassigned records
 -- acquire the operating team lead.
 UPDATE public.relationship_organizations
 SET owner_profile_id=v_owner,
     metadata=metadata||jsonb_build_object('defaultOwnerSetAt',now(),
       'defaultOwnerSource','relationship_centric_workflow_20261018')
 WHERE tenant_id=v_tenant AND owner_profile_id IS NULL;
 UPDATE public.relationship_contacts
 SET owner_profile_id=v_owner,
     metadata=metadata||jsonb_build_object('defaultOwnerSetAt',now(),
       'defaultOwnerSource','relationship_centric_workflow_20261018')
 WHERE tenant_id=v_tenant AND owner_profile_id IS NULL;
 UPDATE public.relationship_opportunities
 SET owner_profile_id=v_owner,
     metadata=metadata||jsonb_build_object('defaultOwnerSetAt',now(),
       'defaultOwnerSource','relationship_centric_workflow_20261018')
 WHERE tenant_id=v_tenant AND owner_profile_id IS NULL;

 -- Do not drop historical user text: preserve exactly duplicated notes
 -- in the entity's metadata for audit and move forward with the opportunity
 -- as the authoritative work owner.
 WITH duplicates AS (
   SELECT org.id,org.next_action,org.next_action_due_at
   FROM public.relationship_organizations org
   WHERE org.tenant_id=v_tenant AND org.next_action IS NOT NULL
     AND (SELECT count(*) FROM public.relationship_opportunities op
          WHERE op.tenant_id=v_tenant AND op.organization_id=org.id)=1
     AND EXISTS(
       SELECT 1 FROM public.relationship_opportunities op
       WHERE op.tenant_id=v_tenant AND op.organization_id=org.id
         AND op.next_action IS NOT DISTINCT FROM org.next_action
         AND op.next_action_due_at IS NOT DISTINCT FROM org.next_action_due_at
     )
 )
 UPDATE public.relationship_organizations org
 SET metadata=org.metadata||jsonb_build_object(
      'previousDuplicatedNextAction',d.next_action,
      'previousDuplicatedDueAt',d.next_action_due_at,
      'duplicateNextActionConsolidatedAt',now()),
     next_action=NULL,next_action_due_at=NULL
 FROM duplicates d WHERE org.id=d.id AND org.tenant_id=v_tenant;

 WITH duplicates AS (
   SELECT c.id,c.next_action,c.next_action_due_at
   FROM public.relationship_contacts c
   WHERE c.tenant_id=v_tenant AND c.next_action IS NOT NULL
     AND (SELECT count(*) FROM public.relationship_opportunities op
          WHERE op.tenant_id=v_tenant AND op.primary_contact_id=c.id)=1
     AND EXISTS(
       SELECT 1 FROM public.relationship_opportunities op
       WHERE op.tenant_id=v_tenant AND op.primary_contact_id=c.id
         AND op.next_action IS NOT DISTINCT FROM c.next_action
         AND op.next_action_due_at IS NOT DISTINCT FROM c.next_action_due_at
     )
 )
 UPDATE public.relationship_contacts c
 SET metadata=c.metadata||jsonb_build_object(
      'previousDuplicatedNextAction',d.next_action,
      'previousDuplicatedDueAt',d.next_action_due_at,
      'duplicateNextActionConsolidatedAt',now()),
     next_action=NULL,next_action_due_at=NULL
 FROM duplicates d WHERE c.id=d.id AND c.tenant_id=v_tenant;
END;
$fn$;

-- These decisions are grounded in existing, unsent Gmail drafts already
-- reviewed against their relationship, not inferred from unread threads.
WITH draft_decisions(id,reason) AS (VALUES
 ('ccbf2b50-1fc6-48bd-ad63-a3e1d4904146'::uuid,
  'Beth Kramer scheduler access confirmed; existing Gmail draft r-6560374764740446007 prepared but not sent. Review/approve reply before waiting for a booking.'),
 ('f2eccbda-4189-4848-94b3-16704ced3c43'::uuid,
  'Drew Walston Oct 28 09:00 CT appointment and accepted RSVP confirmed; existing Gmail draft r758235081418136030 is awaiting approval, not sent.'),
 ('c47b8a29-0c45-4d1d-a9d8-eb3af27657f7'::uuid,
  'Kristy Andrews cannot attend the Oct 21 pre-interview; scheduler supports rescheduling. Existing Gmail draft r-1840479816138682408 is awaiting approval, and replacement booking remains unconfirmed.'),
 ('10d9fc3f-154c-4ed8-a391-69b93879f591'::uuid,
  'Maggie Vet2Vet Maine provided morning availability; existing Gmail draft r-6704234829334033585 prepared and unsent, pending review.')
)
UPDATE public.relationship_opportunities op SET
 attention_status='awaiting_approval',
 attention_note=d.reason,
 attention_assessed_at=now(),
 attention_assessed_through_at=(
   SELECT max(c.occurred_at) FROM public.relationship_communications c
   WHERE c.tenant_id=op.tenant_id AND c.opportunity_id=op.id AND c.direction='inbound'
 )
FROM draft_decisions d
WHERE op.tenant_id='00000000-0000-0000-0000-000000000001'::uuid AND op.id=d.id
 AND op.attention_status IS NULL;
