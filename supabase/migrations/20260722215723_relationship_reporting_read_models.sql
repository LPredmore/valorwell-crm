create or replace view public.relationship_organization_directory_v
with (security_invoker = true)
as
select
  o.id,
  o.tenant_id,
  o.name,
  o.website,
  o.organization_kind,
  o.veteran_affiliated,
  o.outreach_status,
  o.relationship_stage,
  o.owner_profile_id,
  o.next_action,
  o.next_action_due_at,
  o.last_contact_at,
  greatest(o.last_contact_at, interaction_summary.last_interaction_at) as last_interaction_at,
  o.do_not_contact,
  o.source,
  o.created_at,
  o.updated_at,
  coalesce(contact_summary.contact_count, 0)::bigint as contact_count,
  coalesce(opportunity_summary.opportunity_count, 0)::bigint as opportunity_count,
  coalesce(opportunity_summary.open_opportunity_count, 0)::bigint as open_opportunity_count
from public.relationship_organizations o
left join lateral (
  select count(*)::bigint as contact_count
  from public.relationship_contact_organizations affiliation
  where affiliation.tenant_id = o.tenant_id
    and affiliation.organization_id = o.id
) contact_summary on true
left join lateral (
  select
    count(*)::bigint as opportunity_count,
    count(*) filter (where opportunity.status not in ('declined','disqualified','completed'))::bigint as open_opportunity_count
  from public.relationship_opportunities opportunity
  where opportunity.tenant_id = o.tenant_id
    and opportunity.organization_id = o.id
) opportunity_summary on true
left join lateral (
  select max(interaction.occurred_at) as last_interaction_at
  from public.relationship_interactions interaction
  where interaction.tenant_id = o.tenant_id
    and interaction.organization_id = o.id
) interaction_summary on true;

create or replace view public.relationship_contact_directory_v
with (security_invoker = true)
as
select
  c.id,
  c.tenant_id,
  coalesce(nullif(trim(c.preferred_name), ''), nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), c.email, 'Unnamed contact') as display_name,
  case when coalesce(c.preferred_name, c.first_name, c.last_name) is null then 'role_inbox' else 'person' end as contact_kind,
  c.first_name,
  c.last_name,
  c.preferred_name,
  c.email,
  c.phone,
  c.state,
  c.veteran_affiliation,
  c.outreach_status,
  c.relationship_stage,
  c.owner_profile_id,
  c.next_action,
  c.next_action_due_at,
  c.last_contact_at,
  greatest(c.last_contact_at, interaction_summary.last_interaction_at) as last_interaction_at,
  c.do_not_contact,
  primary_affiliation.organization_id as primary_organization_id,
  primary_affiliation.organization_name as primary_organization_name,
  coalesce(affiliation_summary.organization_count, 0)::bigint as organization_count,
  c.source,
  c.created_at,
  c.updated_at
from public.relationship_contacts c
left join lateral (
  select affiliation.organization_id, organization.name as organization_name
  from public.relationship_contact_organizations affiliation
  join public.relationship_organizations organization
    on organization.tenant_id = affiliation.tenant_id
   and organization.id = affiliation.organization_id
  where affiliation.tenant_id = c.tenant_id
    and affiliation.contact_id = c.id
  order by affiliation.is_primary desc, affiliation.created_at asc, affiliation.organization_id
  limit 1
) primary_affiliation on true
left join lateral (
  select count(*)::bigint as organization_count
  from public.relationship_contact_organizations affiliation
  where affiliation.tenant_id = c.tenant_id
    and affiliation.contact_id = c.id
) affiliation_summary on true
left join lateral (
  select max(interaction.occurred_at) as last_interaction_at
  from public.relationship_interactions interaction
  where interaction.tenant_id = c.tenant_id
    and interaction.contact_id = c.id
) interaction_summary on true;

create or replace view public.relationship_opportunity_pipeline_v
with (security_invoker = true)
as
select
  opportunity.id,
  opportunity.tenant_id,
  opportunity.organization_id,
  organization.name as organization_name,
  opportunity.primary_contact_id,
  coalesce(nullif(trim(contact.preferred_name), ''), nullif(trim(concat_ws(' ', contact.first_name, contact.last_name)), ''), contact.email) as primary_contact_name,
  contact.email as primary_contact_email,
  opportunity.status,
  opportunity.review_status,
  opportunity.owner_profile_id,
  opportunity.cause_area,
  opportunity.veteran_priority,
  opportunity.risk_flags,
  opportunity.next_action,
  opportunity.next_action_due_at,
  opportunity.status_changed_at,
  opportunity.closed_at,
  opportunity.version,
  interaction_summary.last_interaction_at,
  opportunity.created_at,
  opportunity.updated_at
from public.relationship_opportunities opportunity
join public.relationship_organizations organization
  on organization.tenant_id = opportunity.tenant_id
 and organization.id = opportunity.organization_id
left join public.relationship_contacts contact
  on contact.tenant_id = opportunity.tenant_id
 and contact.id = opportunity.primary_contact_id
left join lateral (
  select max(interaction.occurred_at) as last_interaction_at
  from public.relationship_interactions interaction
  where interaction.tenant_id = opportunity.tenant_id
    and interaction.opportunity_id = opportunity.id
) interaction_summary on true;

create or replace view public.relationship_campaign_summary_v
with (security_invoker = true)
as
select
  campaign.id,
  campaign.tenant_id,
  campaign.name,
  campaign.purpose,
  campaign.initiative,
  campaign.owner_profile_id,
  campaign.sender_name,
  campaign.sender_email,
  campaign.status,
  campaign.marketing_lifecycle_stage,
  campaign.execution_enabled,
  campaign.activated_at,
  campaign.completed_at,
  campaign.version,
  campaign.created_at,
  campaign.updated_at,
  coalesce(step_summary.step_count, 0)::bigint as step_count,
  coalesce(enrollment_summary.enrollment_count, 0)::bigint as enrollment_count,
  coalesce(enrollment_summary.pending_count, 0)::bigint as pending_count,
  coalesce(enrollment_summary.active_count, 0)::bigint as active_count,
  coalesce(enrollment_summary.responded_count, 0)::bigint as responded_count,
  coalesce(enrollment_summary.completed_count, 0)::bigint as completed_count,
  coalesce(enrollment_summary.failed_count, 0)::bigint as failed_enrollment_count,
  coalesce(communication_summary.sent_count, 0)::bigint as sent_count,
  coalesce(communication_summary.delivered_count, 0)::bigint as delivered_count,
  coalesce(communication_summary.failed_count, 0)::bigint as failed_communication_count,
  coalesce(communication_summary.bounced_count, 0)::bigint as bounced_count,
  coalesce(reply_summary.reply_count, 0)::bigint as reply_count,
  coalesce(suppression_summary.suppression_count, 0)::bigint as active_suppression_count
from public.relationship_campaigns campaign
left join lateral (
  select count(*) filter (where step.is_active)::bigint as step_count
  from public.relationship_campaign_steps step
  where step.tenant_id = campaign.tenant_id
    and step.campaign_id = campaign.id
) step_summary on true
left join lateral (
  select
    count(*)::bigint as enrollment_count,
    count(*) filter (where enrollment.status = 'pending')::bigint as pending_count,
    count(*) filter (where enrollment.status = 'active')::bigint as active_count,
    count(*) filter (where enrollment.status = 'responded')::bigint as responded_count,
    count(*) filter (where enrollment.status = 'completed')::bigint as completed_count,
    count(*) filter (where enrollment.status = 'failed')::bigint as failed_count
  from public.relationship_campaign_enrollments enrollment
  where enrollment.tenant_id = campaign.tenant_id
    and enrollment.campaign_id = campaign.id
) enrollment_summary on true
left join lateral (
  select
    count(*) filter (where communication.direction = 'outbound' and communication.status in ('sent','delivered'))::bigint as sent_count,
    count(*) filter (where communication.direction = 'outbound' and communication.status = 'delivered')::bigint as delivered_count,
    count(*) filter (where communication.direction = 'outbound' and communication.status = 'failed')::bigint as failed_count,
    count(*) filter (where communication.direction = 'outbound' and communication.status = 'bounced')::bigint as bounced_count
  from public.relationship_communications communication
  where communication.tenant_id = campaign.tenant_id
    and communication.campaign_id = campaign.id
) communication_summary on true
left join lateral (
  select count(*)::bigint as reply_count
  from public.relationship_replies reply
  where reply.tenant_id = campaign.tenant_id
    and exists (
      select 1
      from public.relationship_communications communication
      where communication.tenant_id = reply.tenant_id
        and communication.id = reply.communication_id
        and communication.campaign_id = campaign.id
    )
) reply_summary on true
left join lateral (
  select count(*)::bigint as suppression_count
  from public.relationship_suppressions suppression
  where suppression.tenant_id = campaign.tenant_id
    and suppression.campaign_id = campaign.id
    and suppression.revoked_at is null
    and (suppression.expires_at is null or suppression.expires_at > now())
) suppression_summary on true;

create or replace view public.relationship_reply_queue_v
with (security_invoker = true)
as
select
  reply.id,
  reply.tenant_id,
  reply.communication_id,
  reply.enrollment_id,
  reply.organization_id,
  organization.name as organization_name,
  reply.contact_id,
  coalesce(nullif(trim(contact.preferred_name), ''), nullif(trim(concat_ws(' ', contact.first_name, contact.last_name)), ''), contact.email) as contact_name,
  reply.opportunity_id,
  reply.owner_profile_id,
  reply.status,
  reply.follow_up_due_at,
  reply.resolved_at,
  reply.version,
  communication.campaign_id,
  campaign.name as campaign_name,
  communication.sender_email,
  communication.recipient_email,
  communication.subject,
  communication.rendered_body as body,
  communication.occurred_at as received_at,
  reply.created_at,
  reply.updated_at
from public.relationship_replies reply
join public.relationship_communications communication
  on communication.tenant_id = reply.tenant_id
 and communication.id = reply.communication_id
left join public.relationship_organizations organization
  on organization.tenant_id = reply.tenant_id
 and organization.id = reply.organization_id
left join public.relationship_contacts contact
  on contact.tenant_id = reply.tenant_id
 and contact.id = reply.contact_id
left join public.relationship_campaigns campaign
  on campaign.tenant_id = communication.tenant_id
 and campaign.id = communication.campaign_id;

create or replace view public.relationship_report_metrics_v
with (security_invoker = true)
as
with visible_tenants as (
  select tenant_id from public.relationship_contacts
  union select tenant_id from public.relationship_organizations
  union select tenant_id from public.relationship_opportunities
  union select tenant_id from public.relationship_campaigns
  union select tenant_id from public.relationship_imports
  union select tenant_id from public.relationship_replies
), metrics as (
  select tenant.tenant_id, 'organizations_needing_review'::text as metric_key, 'Organizations needing review'::text as label,
    (select count(*) from public.relationship_organizations organization where organization.tenant_id = tenant.tenant_id and organization.outreach_status in ('new','reviewing') and not organization.do_not_contact)::numeric as metric_value
  from visible_tenants tenant
  union all select tenant.tenant_id, 'opportunities_needing_qualification', 'BTY opportunities needing qualification',
    (select count(*) from public.relationship_opportunities opportunity where opportunity.tenant_id = tenant.tenant_id and (opportunity.status in ('identified','researching') or opportunity.review_status <> 'approved'))::numeric
  from visible_tenants tenant
  union all select tenant.tenant_id, 'overdue_next_actions', 'Overdue next actions',
    ((select count(*) from public.relationship_organizations organization where organization.tenant_id = tenant.tenant_id and organization.next_action_due_at < now()) +
     (select count(*) from public.relationship_contacts contact where contact.tenant_id = tenant.tenant_id and contact.next_action_due_at < now()) +
     (select count(*) from public.relationship_opportunities opportunity where opportunity.tenant_id = tenant.tenant_id and opportunity.next_action_due_at < now() and opportunity.status not in ('declined','disqualified','completed')))::numeric
  from visible_tenants tenant
  union all select tenant.tenant_id, 'unassigned_relationships', 'Unassigned relationships',
    ((select count(*) from public.relationship_organizations organization where organization.tenant_id = tenant.tenant_id and organization.owner_profile_id is null and not organization.do_not_contact) +
     (select count(*) from public.relationship_contacts contact where contact.tenant_id = tenant.tenant_id and contact.owner_profile_id is null and not contact.do_not_contact))::numeric
  from visible_tenants tenant
  union all select tenant.tenant_id, 'active_outreach_campaigns', 'Active outreach campaigns',
    (select count(*) from public.relationship_campaigns campaign where campaign.tenant_id = tenant.tenant_id and campaign.status = 'active')::numeric
  from visible_tenants tenant
  union all select tenant.tenant_id, 'replies_requiring_staff_action', 'Replies requiring staff action',
    (select count(*) from public.relationship_replies reply where reply.tenant_id = tenant.tenant_id and reply.status <> 'resolved')::numeric
  from visible_tenants tenant
  union all select tenant.tenant_id, 'import_conflicts', 'Import conflicts',
    coalesce((select sum(import_batch.conflict_count) from public.relationship_imports import_batch where import_batch.tenant_id = tenant.tenant_id and import_batch.status not in ('completed','cancelled')), 0)::numeric
  from visible_tenants tenant
  union all select tenant.tenant_id, 'recently_updated_relationships', 'Recently updated relationships',
    ((select count(*) from public.relationship_organizations organization where organization.tenant_id = tenant.tenant_id and organization.updated_at >= now() - interval '7 days') +
     (select count(*) from public.relationship_contacts contact where contact.tenant_id = tenant.tenant_id and contact.updated_at >= now() - interval '7 days'))::numeric
  from visible_tenants tenant
  union all select tenant.tenant_id, 'total_organizations', 'Total organizations',
    (select count(*) from public.relationship_organizations organization where organization.tenant_id = tenant.tenant_id)::numeric
  from visible_tenants tenant
  union all select tenant.tenant_id, 'total_contacts', 'Total contacts',
    (select count(*) from public.relationship_contacts contact where contact.tenant_id = tenant.tenant_id)::numeric
  from visible_tenants tenant
  union all select tenant.tenant_id, 'open_opportunities', 'Open BTY opportunities',
    (select count(*) from public.relationship_opportunities opportunity where opportunity.tenant_id = tenant.tenant_id and opportunity.status not in ('declined','disqualified','completed'))::numeric
  from visible_tenants tenant
  union all select tenant.tenant_id, 'active_suppressions', 'Active suppressions',
    (select count(*) from public.relationship_suppressions suppression where suppression.tenant_id = tenant.tenant_id and suppression.revoked_at is null and (suppression.expires_at is null or suppression.expires_at > now()))::numeric
  from visible_tenants tenant
)
select tenant_id, metric_key, label, metric_value, now() as measured_at
from metrics;

revoke all on public.relationship_organization_directory_v from anon;
revoke all on public.relationship_contact_directory_v from anon;
revoke all on public.relationship_opportunity_pipeline_v from anon;
revoke all on public.relationship_campaign_summary_v from anon;
revoke all on public.relationship_reply_queue_v from anon;
revoke all on public.relationship_report_metrics_v from anon;

grant select on public.relationship_organization_directory_v to authenticated;
grant select on public.relationship_contact_directory_v to authenticated;
grant select on public.relationship_opportunity_pipeline_v to authenticated;
grant select on public.relationship_campaign_summary_v to authenticated;
grant select on public.relationship_reply_queue_v to authenticated;
grant select on public.relationship_report_metrics_v to authenticated;
