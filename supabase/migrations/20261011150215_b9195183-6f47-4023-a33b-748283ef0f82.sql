do $$
declare v_def text:=pg_get_functiondef('private.apply_relationship_activity(uuid,text,text,text,text,uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,jsonb,uuid)'::regprocedure); v_new text;
begin
  if position('metadata=w.metadata||' in v_def)>0 then return; end if;
  v_new:=regexp_replace(v_def,'metadata=metadata\|\|jsonb_build_object\(''cancelled_by_activity_event_id'',v_activity\.id\)(\s+from public\.relationship_campaign_enrollments e)',
    'metadata=w.metadata||jsonb_build_object(''cancelled_by_activity_event_id'',v_activity.id)\1');
  if v_new=v_def then raise exception 'apply_relationship_activity shape changed'; end if;
  execute v_new;
end $$;