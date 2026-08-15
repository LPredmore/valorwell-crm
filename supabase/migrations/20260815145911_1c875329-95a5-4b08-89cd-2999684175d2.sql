DO $mig$
DECLARE
  v_def text;
  v_new text;
BEGIN
  FOR v_def IN
    SELECT pg_get_functiondef(p.oid)
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('ai_ops_build_client_journey_batches', 'ai_ops_build_communications_batches')
  LOOP
    -- `text[] || 'literal'` is ambiguous in Postgres and can resolve to array||array,
    -- which fails as a malformed array literal. Append explicitly instead.
    v_new := regexp_replace(
      v_def,
      $re$([a-z_]+) := \1 \|\| ('[A-Za-z0-9_]+')$re$,
      $rp$\1 := array_append(\1, \2::text)$rp$,
      'g'
    );
    IF v_new = v_def THEN
      RAISE NOTICE 'no signal-append fix needed';
    ELSE
      EXECUTE v_new;
    END IF;
  END LOOP;
END
$mig$;

DO $mig$
DECLARE
  v_tenant uuid := '00000000-0000-0000-0000-000000000001';
  v_run uuid;
  v_cutoff timestamptz;
  v_purged jsonb;
  v_journey jsonb;
  v_comms jsonb;
BEGIN
  SELECT id, source_cutoff_at INTO v_run, v_cutoff
  FROM public.ai_operations_runs
  WHERE tenant_id = v_tenant AND overall_status = 'running'
  ORDER BY business_date DESC LIMIT 1;

  IF v_run IS NULL THEN
    RAISE NOTICE 'No in-progress AI Operations run; nothing to rebuild.';
    RETURN;
  END IF;

  SET LOCAL ROLE service_role;
  v_purged := public.ai_ops_purge_stale_work_items(v_tenant, v_run);
  v_journey := public.ai_ops_build_client_journey_batches(v_tenant, v_run, v_cutoff);
  v_comms := public.ai_ops_build_communications_batches(v_tenant, v_run, v_cutoff);
  RESET ROLE;

  RAISE NOTICE 'purged=% journey=% comms=%', v_purged, v_journey, v_comms;
END
$mig$;

SELECT cron.schedule(
  'ai-ops-onetime-flash-validation',
  '15 15 15 8 *',
  $$select private.ai_ops_invoke('ai-operations-model-worker', '{"limit":2}'::jsonb);$$
);
