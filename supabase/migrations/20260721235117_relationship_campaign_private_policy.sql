create policy relationship_campaign_idempotency_service
on private.relationship_campaign_idempotency
for all
to service_role
using (true)
with check (true);
