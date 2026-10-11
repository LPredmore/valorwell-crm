do $$
declare v_def text:=pg_get_functiondef('public.ingest_relationship_calendar_event(uuid,uuid,text,text,text,text,timestamptz,timestamptz,text[],text,text,timestamptz,jsonb)'::regprocedure); v_new text;
begin
  if position('%s@%s' in v_def)>0 then return; end if;
  v_new:=replace(v_def,'    p_external_event_id,v_meeting.organization_id,v_meeting.contact_id,v_meeting.opportunity_id,',
    '    format(''%s@%s'',p_external_event_id,coalesce(p_updated_at,now())),v_meeting.organization_id,v_meeting.contact_id,v_meeting.opportunity_id,');
  if v_new=v_def then raise exception 'ingest_relationship_calendar_event shape changed'; end if;
  execute v_new;
end $$;