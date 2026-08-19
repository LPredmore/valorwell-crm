do $activation$
declare
  v_campaign public.relationship_campaigns%rowtype;
  v_cutoff timestamptz:=clock_timestamp();
  v_readiness jsonb;
  v_count integer;
begin
  select count(*) into v_count
  from public.relationship_campaigns c
  where c.source_record_key='bty_recommended_organization_outreach_v1';

  if v_count<>1 then
    raise exception 'Expected exactly one BTY Recommended Organization campaign, found %.',v_count;
  end if;

  select * into v_campaign
  from public.relationship_campaigns c
  where c.source_record_key='bty_recommended_organization_outreach_v1'
  for update;

  if exists(
    select 1 from public.relationship_campaign_enrollments e
    where e.tenant_id=v_campaign.tenant_id and e.campaign_id=v_campaign.id
  ) then
    raise exception 'BTY Recommended Organization campaign must have zero enrollments at auto-enrollment cutover.';
  end if;

  if exists(
    select 1 from public.relationship_communications c
    where c.tenant_id=v_campaign.tenant_id and c.campaign_id=v_campaign.id
  ) then
    raise exception 'BTY Recommended Organization campaign must have zero communications at auto-enrollment cutover.';
  end if;

  update public.relationship_campaigns
  set status='active',
      marketing_lifecycle_stage='live',
      activated_at=coalesce(activated_at,v_cutoff),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'activation_state','live_auto_enrollment',
        'manual_activation_required',false,
        'autoEnrollmentEnabled',true,
        'autoEnrollmentPolicy','new_nomination_event_v1',
        'autoEnrollmentStartedAt',v_cutoff,
        'historicalBackfill',false
      )
  where id=v_campaign.id;

  v_readiness:=private.relationship_delivery_readiness(v_campaign.tenant_id,v_campaign.id);
  if coalesce((v_readiness->>'ready')::boolean,false) is not true then
    raise exception 'BTY Recommended Organization campaign delivery is not ready: %',
      coalesce(v_readiness->'reasons','[]'::jsonb)::text;
  end if;

  perform set_config('app.relationship_delivery_activation','allowed',true);
  update public.relationship_campaigns
  set execution_enabled=true
  where id=v_campaign.id;
end;
$activation$;
