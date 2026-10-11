DO $mig$
DECLARE v_def text; v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ingest_relationship_calendar_event'::regproc);
  v_new := replace(v_def,
$o$    v_purpose:=case when p_streamyard_url='https://streamyard.com/frr4zf8e3s' then 'bty_recording'
      when coalesce(p_metadata->>'bty_classification','')='bty_preinterview' then 'bty_preinterview' end;$o$,
$n$    -- Server-computed classification wins; StreamYard room is only the fallback.
    v_purpose:=case
      when coalesce(p_metadata->>'bty_classification','')='bty_preinterview' then 'bty_preinterview'
      when coalesce(p_metadata->>'bty_classification','')='bty_recording' then 'bty_recording'
      when p_streamyard_url='https://streamyard.com/frr4zf8e3s' then 'bty_recording' end;$n$);
  IF v_new = v_def THEN
    RAISE EXCEPTION 'ingest_relationship_calendar_event classification block not found';
  END IF;
  EXECUTE v_new;
END $mig$;