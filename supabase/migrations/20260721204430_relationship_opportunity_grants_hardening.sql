revoke all on table public.relationship_opportunities from authenticated;
grant select, insert on table public.relationship_opportunities to authenticated;
grant update (
  primary_contact_id, owner_profile_id, cause_area, veteran_priority,
  qualification, review_status, risk_flags, next_action, next_action_due_at,
  metadata, updated_by_profile_id
) on table public.relationship_opportunities to authenticated;

revoke all on table public.relationship_opportunity_status_history from authenticated;
grant select on table public.relationship_opportunity_status_history to authenticated;
