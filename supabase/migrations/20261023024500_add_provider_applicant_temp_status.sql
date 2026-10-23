-- Temporary applicant status for isolated live campaign test.
-- Forward-only PostgreSQL enum migration. Keep separate from uses of the new value.
ALTER TYPE public.provider_applicant_status_enum ADD VALUE IF NOT EXISTS 'temp' AFTER 'new';
