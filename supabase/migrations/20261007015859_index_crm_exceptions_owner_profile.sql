-- Cover the exception owner foreign key and owner-based operational filtering.
CREATE INDEX IF NOT EXISTS idx_crm_exceptions_owner_id
ON public.crm_exceptions(owner_id);
