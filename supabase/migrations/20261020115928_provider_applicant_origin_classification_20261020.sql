-- Classify provider applicants by how and when they entered the pipeline.
-- 'Legacy' takes precedence for every applicant entered before July 2026.
-- Keep original source/referral_source unchanged; this is a read-only projection.
ALTER TABLE public.provider_applicants
ADD COLUMN IF NOT EXISTS applicant_origin text GENERATED ALWAYS AS (
  CASE
    WHEN created_at < TIMESTAMPTZ '2026-07-01 00:00:00+00' THEN 'Legacy'
    WHEN lower(btrim(source)) IN ('indeed', 'indeed_application') THEN 'Indeed'
    WHEN lower(btrim(source)) IN ('cold', 'cold_outreach', 'prospecting', 'outbound_prospecting') THEN 'Cold'
    WHEN lower(btrim(source)) IN ('website', 'web_form', 'clinician_interest_form') THEN 'Website'
    ELSE 'Other'
  END
) STORED;

COMMENT ON COLUMN public.provider_applicants.applicant_origin IS
  'Read-only applicant acquisition classification. Any applicant created before July 1 2026 UTC is Legacy, otherwise Indeed, Cold, Website, or Other based on original source. Never rewrite source or created_at to change this classification.';

CREATE INDEX IF NOT EXISTS provider_applicants_origin_filter_idx
ON public.provider_applicants (tenant_id, applicant_origin, created_at DESC);
