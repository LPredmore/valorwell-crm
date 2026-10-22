CREATE TABLE IF NOT EXISTS public.clinician_interview_bookings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 applicant_id uuid NOT NULL REFERENCES public.provider_applicants(id) ON DELETE RESTRICT,
 booking_date date NOT NULL,
 starts_at timestamptz NOT NULL,
 ends_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'reserving' CHECK (status IN ('reserving','confirmed','attention','cancelled')),
 google_event_id text,
 google_ical_uid text,
 google_meet_url text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT clinician_interview_60min CHECK (ends_at = starts_at + interval '1 hour'),
 CONSTRAINT clinician_interview_central_date CHECK (booking_date = (starts_at AT TIME ZONE 'America/Chicago')::date)
);
CREATE UNIQUE INDEX IF NOT EXISTS clinician_interview_one_per_day_active
 ON public.clinician_interview_bookings (tenant_id, booking_date)
 WHERE status IN ('reserving','confirmed','attention');
CREATE UNIQUE INDEX IF NOT EXISTS clinician_interview_one_per_applicant_active
 ON public.clinician_interview_bookings (tenant_id, applicant_id)
 WHERE status IN ('reserving','confirmed','attention');
CREATE INDEX IF NOT EXISTS clinician_interview_active_range
 ON public.clinician_interview_bookings (tenant_id, starts_at)
 WHERE status IN ('reserving','confirmed','attention');
ALTER TABLE public.clinician_interview_bookings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.clinician_interview_bookings FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.clinician_interview_bookings TO service_role;
COMMENT ON TABLE public.clinician_interview_bookings IS 'Public clinician interview scheduler reservations; service-role only. Independent from BTY daily meeting limits.';
