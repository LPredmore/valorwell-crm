DO $$
DECLARE v_id bigint;
BEGIN
  SELECT private.ai_ops_invoke('ai-operations-youtube-sync', '{"maxVideos":5}'::jsonb) INTO v_id;
END $$;