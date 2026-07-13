
-- ClickUp retirement: drop write-path triggers and their functions.
-- The historical mirror/config tables (clickup_client_mirror_state,
-- crm_clickup_field_map, crm_clickup_sync_runs) are kept for audit;
-- nothing writes to them once the triggers and edge function are gone.

DROP TRIGGER IF EXISTS trg_clients_clickup_sync ON public.clients;
DROP TRIGGER IF EXISTS trg_enrollment_clickup_sync ON public.crm_campaign_enrollments;

DROP FUNCTION IF EXISTS public.trg_clients_clickup_sync() CASCADE;
DROP FUNCTION IF EXISTS public.trg_enrollment_clickup_sync() CASCADE;
DROP FUNCTION IF EXISTS public.trg_enqueue_clickup_sync() CASCADE;
