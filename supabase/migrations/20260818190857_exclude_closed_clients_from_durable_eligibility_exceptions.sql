CREATE OR REPLACE FUNCTION private.evaluate_client_journey_exceptions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  r record;
  v_due timestamptz;
begin
  -- Latest insurance eligibility technical errors.
  for r in
    with latest as (
      select distinct on (ec.client_id)
        ec.id, ec.tenant_id, ec.client_id, ec.eligibility_status,
        ec.response_message, ec.requested_at
      from public.eligibility_checks ec
      join public.clients c on c.id = ec.client_id
      where c.lifecycle_stage::text <> 'closed'
      order by ec.client_id, ec.requested_at desc, ec.created_at desc, ec.id desc
    )
    select * from latest where eligibility_status = 'technical_error'
  loop
    v_due := private.client_journey_review_due('same_business_day', clock_timestamp());
    perform public.create_client_journey_exception(
      r.tenant_id,
      r.client_id,
      'Technical',
      'insurance_eligibility_technical_error',
      'The latest insurance eligibility request returned a technical error and requires human review.',
      'Investigate the verification failure and complete or rerun eligibility review.',
      v_due,
      null,
      'system_exception_evaluator',
      'eligibility_check',
      r.id,
      jsonb_build_object('eligibility_status',r.eligibility_status,'requested_at',r.requested_at)
    );
  end loop;

  update public.client_journey_exceptions e
  set resolution_state = 'resolved',
      resolution_note = 'Automatically resolved because the client is closed or the related eligibility technical error is no longer the latest eligibility result.',
      resolved_at = clock_timestamp(),
      resolved_by_profile_id = null,
      source = 'system_exception_evaluator'
  where e.run_key is null
    and e.reason_code = 'insurance_eligibility_technical_error'
    and e.resolution_state in ('open','in_progress')
    and (
      exists (select 1 from public.clients c where c.id=e.client_id and c.lifecycle_stage::text='closed')
      or not exists (
        select 1
        from (
          select distinct on (ec.client_id)
            ec.id, ec.client_id, ec.eligibility_status
          from public.eligibility_checks ec
          order by ec.client_id, ec.requested_at desc, ec.created_at desc, ec.id desc
        ) latest
        where latest.client_id = e.client_id
          and latest.id = e.related_entity_id
          and latest.eligibility_status = 'technical_error'
      )
    );

  -- OHI / payer-order review from active insurance records explicitly reporting other coverage.
  for r in
    select ci.id, ci.tenant_id, ci.client_id, ci.payer_name, ci.payer_order
    from public.client_insurance ci
    join public.clients c on c.id=ci.client_id
    where ci.is_active is true
      and ci.has_other_coverage is true
      and c.lifecycle_stage::text <> 'closed'
  loop
    v_due := private.client_journey_review_due('one_business_day', clock_timestamp());
    perform public.create_client_journey_exception(
      r.tenant_id,
      r.client_id,
      'OHI / Payer Order',
      'ohi_payer_order_review_required',
      'An active insurance record reports other health insurance and payer order must be reviewed before therapist selection.',
      'Determine payer order and clear or retain the therapist-selection gate.',
      v_due,
      null,
      'system_exception_evaluator',
      'client_insurance',
      r.id,
      jsonb_build_object('payer_name',r.payer_name,'payer_order',r.payer_order)
    );
  end loop;

  update public.client_journey_exceptions e
  set resolution_state = 'resolved',
      resolution_note = 'Automatically resolved because the client is closed or the related active insurance record no longer reports other coverage.',
      resolved_at = clock_timestamp(),
      resolved_by_profile_id = null,
      source = 'system_exception_evaluator'
  where e.run_key is null
    and e.reason_code = 'ohi_payer_order_review_required'
    and e.resolution_state in ('open','in_progress')
    and (
      exists (select 1 from public.clients c where c.id=e.client_id and c.lifecycle_stage::text='closed')
      or not exists (
        select 1 from public.client_insurance ci
        where ci.id = e.related_entity_id
          and ci.client_id = e.client_id
          and ci.is_active is true
          and ci.has_other_coverage is true
      )
    );

  -- Therapist-led scheduling with no appointment movement after 24 hours.
  for r in
    select c.id as client_id, c.tenant_id, c.primary_staff_id,
           c.lifecycle_stage_changed_at
    from public.clients c
    join public.staff s
      on s.id = c.primary_staff_id
     and s.tenant_id = c.tenant_id
    where c.lifecycle_stage::text = 'matched'
      and c.lifecycle_stage_changed_at <= clock_timestamp() - interval '24 hours'
      and s.prov_self_scheduling_enabled is false
      and not exists (
        select 1 from public.appointments a
        where a.client_id = c.id
          and a.created_at >= c.lifecycle_stage_changed_at
      )
  loop
    v_due := private.client_journey_review_due('same_business_day', clock_timestamp());
    perform public.create_client_journey_exception(
      r.tenant_id,
      r.client_id,
      'Other',
      'therapist_scheduling_no_movement_24h',
      'The client selected a therapist who requires therapist-led scheduling, but no appointment movement occurred within 24 hours.',
      'Confirm therapist outreach and move the client to a scheduled appointment or reassign the scheduling action.',
      v_due,
      null,
      'system_exception_evaluator',
      'staff',
      r.primary_staff_id,
      jsonb_build_object('matched_since',r.lifecycle_stage_changed_at)
    );
  end loop;

  update public.client_journey_exceptions e
  set resolution_state = 'resolved',
      resolution_note = 'Automatically resolved because scheduling movement occurred or the client no longer meets the therapist-led scheduling exception condition.',
      resolved_at = clock_timestamp(),
      resolved_by_profile_id = null,
      source = 'system_exception_evaluator'
  where e.run_key is null
    and e.reason_code = 'therapist_scheduling_no_movement_24h'
    and e.resolution_state in ('open','in_progress')
    and not exists (
      select 1
      from public.clients c
      join public.staff s
        on s.id = c.primary_staff_id
       and s.tenant_id = c.tenant_id
      where c.id = e.client_id
        and c.lifecycle_stage::text = 'matched'
        and c.lifecycle_stage_changed_at <= clock_timestamp() - interval '24 hours'
        and c.primary_staff_id = e.related_entity_id
        and s.prov_self_scheduling_enabled is false
        and not exists (
          select 1 from public.appointments a
          where a.client_id = c.id
            and a.created_at >= c.lifecycle_stage_changed_at
        )
    );

  -- Durable coverage/manual-review exceptions apply only to an active care journey.
  -- Closed clients retain their canonical eligibility history but do not generate
  -- operational eligibility work until they reactivate.
  for r in
    select c.id as client_id, c.tenant_id, c.eligibility_state::text as eligibility_state
    from public.clients c
    where c.lifecycle_stage::text <> 'closed'
      and c.eligibility_state::text in ('coverage_issue','manual_review')
      and not exists (
        select 1 from public.client_journey_exceptions e
        where e.client_id = c.id
          and e.resolution_state in ('open','in_progress')
          and e.category in ('Insurance','OHI / Payer Order','Eligibility','Technical')
      )
  loop
    v_due := private.client_journey_review_due('one_business_day', clock_timestamp());
    if r.eligibility_state = 'coverage_issue' then
      perform public.create_client_journey_exception(
        r.tenant_id, r.client_id, 'Insurance', 'insurance_coverage_issue',
        'The canonical eligibility state indicates an unresolved coverage issue.',
        'Review current insurance information and complete the supported-pathway decision.',
        v_due, null, 'system_exception_evaluator', null, null,
        jsonb_build_object('eligibility_state',r.eligibility_state)
      );
    else
      perform public.create_client_journey_exception(
        r.tenant_id, r.client_id, 'Eligibility', 'eligibility_manual_review_required',
        'The canonical eligibility state requires human review before the care pathway can proceed.',
        'Complete the manual eligibility review and update the canonical eligibility state.',
        v_due, null, 'system_exception_evaluator', null, null,
        jsonb_build_object('eligibility_state',r.eligibility_state)
      );
    end if;
  end loop;

  update public.client_journey_exceptions e
  set resolution_state = 'resolved',
      resolution_note = 'Automatically resolved because the client is closed or the canonical eligibility state no longer has this condition.',
      resolved_at = clock_timestamp(),
      resolved_by_profile_id = null,
      source = 'system_exception_evaluator'
  from public.clients c
  where c.id = e.client_id
    and e.run_key is null
    and e.resolution_state in ('open','in_progress')
    and (
      c.lifecycle_stage::text = 'closed'
      or (e.reason_code = 'insurance_coverage_issue' and c.eligibility_state::text <> 'coverage_issue')
      or (e.reason_code = 'eligibility_manual_review_required' and c.eligibility_state::text <> 'manual_review')
    );

  return jsonb_build_object(
    'evaluated_at', clock_timestamp(),
    'active_operational_exceptions', (
      select count(*) from public.client_journey_exceptions
      where run_key is null and resolution_state in ('open','in_progress')
    ),
    'active_by_reason', coalesce((
      select jsonb_object_agg(reason_code, n)
      from (
        select reason_code, count(*) n
        from public.client_journey_exceptions
        where run_key is null and resolution_state in ('open','in_progress')
        group by reason_code
      ) counts
    ), '{}'::jsonb)
  );
end;
$function$;
