DO $$
DECLARE v_id bigint;
BEGIN
  SELECT private.ai_ops_invoke('ai-operations-youtube-sync', '{"verifyOnly":true}'::jsonb) INTO v_id;
  RAISE NOTICE 'request %', v_id;
END $$;