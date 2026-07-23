-- The Email Studio foundation adds the tenant-aware composite template reference.
-- Remove the older single-column reference so one canonical foreign key owns this relationship.

ALTER TABLE public.crm_bulk_send_logs
  DROP CONSTRAINT IF EXISTS crm_bulk_send_logs_template_id_fkey;
