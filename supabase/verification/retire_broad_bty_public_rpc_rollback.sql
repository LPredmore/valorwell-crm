-- Emergency rollback only. This restores a broad, legacy public surface and
-- should be used only with explicit product/security approval after the prior
-- Website build has also been restored.

grant execute on function public.submit_website_bty_submission(jsonb)
  to anon, authenticated;

comment on function public.submit_website_bty_submission(jsonb) is
  'Legacy BTY Website intake temporarily restored during an approved rollback.';
