-- Cover BTY orchestration foreign keys and bind meetings to the private connection row.

alter table public.relationship_meetings
  add constraint relationship_meetings_connection_fkey
  foreign key (connection_id) references private.relationship_google_connections(id) on delete cascade;

create index relationship_activity_events_campaign_fk_idx
  on public.relationship_activity_events(tenant_id,campaign_id) where campaign_id is not null;
create index relationship_activity_events_communication_fk_idx
  on public.relationship_activity_events(tenant_id,communication_id) where communication_id is not null;
create index relationship_activity_events_contact_fk_idx
  on public.relationship_activity_events(tenant_id,contact_id) where contact_id is not null;
create index relationship_activity_events_enrollment_fk_idx
  on public.relationship_activity_events(tenant_id,enrollment_id) where enrollment_id is not null;
create index relationship_activity_events_organization_fk_idx
  on public.relationship_activity_events(tenant_id,organization_id) where organization_id is not null;
create index relationship_message_observations_communication_fk_idx
  on public.relationship_message_observations(tenant_id,communication_id);
create index relationship_meetings_contact_fk_idx
  on public.relationship_meetings(tenant_id,contact_id);
create index relationship_meetings_organization_fk_idx
  on public.relationship_meetings(tenant_id,organization_id);
create index relationship_meetings_connection_fk_idx
  on public.relationship_meetings(connection_id);
create index relationship_reconciliation_issues_activity_fk_idx
  on public.relationship_reconciliation_issues(tenant_id,activity_event_id) where activity_event_id is not null;
create index relationship_reconciliation_issues_opportunity_fk_idx
  on public.relationship_reconciliation_issues(tenant_id,opportunity_id) where opportunity_id is not null;
create index relationship_reconciliation_issues_resolver_fk_idx
  on public.relationship_reconciliation_issues(resolved_by_profile_id) where resolved_by_profile_id is not null;
create index relationship_feature_flags_updater_fk_idx
  on private.relationship_feature_flags(updated_by_profile_id) where updated_by_profile_id is not null;
create index relationship_google_connections_tenant_idx
  on private.relationship_google_connections(tenant_id);
create index relationship_google_connections_connector_fk_idx
  on private.relationship_google_connections(connected_by_profile_id) where connected_by_profile_id is not null;
create index relationship_google_oauth_states_tenant_idx
  on private.relationship_google_oauth_states(tenant_id);
create index relationship_google_oauth_states_actor_fk_idx
  on private.relationship_google_oauth_states(actor_profile_id);
create index relationship_bty_auto_enrollment_campaign_fk_idx
  on private.relationship_bty_auto_enrollment_idempotency(tenant_id,campaign_id);
create index relationship_bty_auto_enrollment_enrollment_fk_idx
  on private.relationship_bty_auto_enrollment_idempotency(tenant_id,enrollment_id) where enrollment_id is not null;

