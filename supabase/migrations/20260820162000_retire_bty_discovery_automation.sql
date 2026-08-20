-- Retire the autonomous Beyond The Yellow prospect discovery/contact-enrichment system.
-- BTY nominations, candidate management, outreach, campaigns, interviews, and historical automation records remain intact.

DO $$
DECLARE
  v_jobid bigint;
BEGIN
  FOR v_jobid IN
    SELECT jobid
    FROM cron.job
    WHERE jobname = 'bty-automation-dispatcher'
  LOOP
    PERFORM cron.unschedule(v_jobid);
  END LOOP;
END
$$;

DROP FUNCTION IF EXISTS private.run_bty_automation_dispatcher();

DROP FUNCTION IF EXISTS public.bty_apply_contact_enrichment(uuid, uuid, uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.bty_automation_overview(integer);
DROP FUNCTION IF EXISTS public.bty_claim_discovery_pass(uuid, date, integer, text);
DROP FUNCTION IF EXISTS public.bty_claim_discovery_run(uuid, date, integer, text);
DROP FUNCTION IF EXISTS public.bty_claim_failure_notification(uuid);
DROP FUNCTION IF EXISTS public.bty_commit_discovery_batch(uuid, jsonb);
DROP FUNCTION IF EXISTS public.bty_commit_discovery_pass(uuid, jsonb, integer, boolean);
DROP FUNCTION IF EXISTS public.bty_contact_enrichment_targets(uuid, date);
DROP FUNCTION IF EXISTS public.bty_discovery_exclusions(uuid, uuid);
DROP FUNCTION IF EXISTS public.bty_discovery_run_snapshot(uuid, date);
DROP FUNCTION IF EXISTS public.bty_mark_run_failed(uuid, integer, jsonb);
DROP FUNCTION IF EXISTS public.bty_next_rotation_state(text);
DROP FUNCTION IF EXISTS public.bty_record_candidate_verdicts(uuid, jsonb);
DROP FUNCTION IF EXISTS public.bty_record_contact_enrichment(uuid, uuid, text, text, jsonb);
DROP FUNCTION IF EXISTS public.bty_rotation_states();
DROP FUNCTION IF EXISTS public.bty_screen_organization_candidates(uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.bty_worker_token_valid(uuid, text);

-- Runtime-only state is removed. Historical run/candidate/enrichment tables are intentionally preserved for audit history.
DROP TABLE IF EXISTS private.bty_automation_runtime;
DROP TABLE IF EXISTS private.bty_discovery_state;
