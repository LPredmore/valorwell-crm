# CRM internal worker RPCs — execution boundaries

The live schema grants authenticated users direct execution on four
postgres-owned SECURITY DEFINER RPCs without internal per-user authorization:
social_queue_publish, crm_enqueue_campaign_trigger_jobs,
crm_correlate_client_email_reply and crm_evaluate_campaign_concurrency.

**Confirmed intended Social Media path:** The CRM social-media-manager
Edge Function authenticates a user, derives tenant/capabilities from
get_crm_operating_context, checks mutate capability, loads the publication
scoped to tenant and invokes social_queue_publish using its service-role client.
The SQL was already service-only in its original 20260922190000 migration;
this migration closes subsequent browser EXECUTE grants.

**Campaign dependency:** crm_emit_automation_event is postgres-owned
SECURITY DEFINER and may invoke crm_enqueue_campaign_trigger_jobs. Owner
execution is preserved. Other server workers use service credentials;
review all direct callers before production deployment.

To accept: isolated two-tenant signed JWT denial for each direct RPC,
positive publication queue with synthetic approved item (NO YouTube upload),
trigger enqueue and inbound email correlation with stub transport,
read-only evaluation via trusted context; assert service-role grant intact.
Release through reviewed migration and compare post-deploy grants. No
real email, video publishing, CRM operational state or clinical writes.
