do $migration$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.relationship_campaigns
  where source_record_key = 'bty_recommended_organization_outreach_v1';

  if v_count <> 1 then
    raise exception 'Expected exactly one BTY Recommended Organization campaign, found %.', v_count;
  end if;

  update public.relationship_campaigns
  set send_window_end = time '16:00:00',
      updated_at = now()
  where source_record_key = 'bty_recommended_organization_outreach_v1';
end;
$migration$;
