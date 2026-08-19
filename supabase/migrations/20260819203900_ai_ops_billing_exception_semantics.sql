-- A Billing service event in explicit exception/not_required state is not a
-- broken clinical->financial handoff merely because it has no claim row.
-- Keep the control deterministic while distinguishing operational exceptions
-- from structural failures.

update public.ai_operations_sop_controls
set control_text = 'A finalized billing service event must progress to a draft claim, an explicit Billing exception, or an explicit not-required state. A service event must not silently stall without one of those outcomes.',
    evidence_contract = evidence_contract || jsonb_build_object(
      'acceptedTerminalNoClaimStates', jsonb_build_array('exception','not_required'),
      'implementationMapping', 'billing_service_events.claim_state distinguishes draft_created, exception and not_required outcomes'
    ),
    updated_at = clock_timestamp()
where tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
  and control_key = 'finance.finalized_service_event_requires_claim';

do $migration$
declare
  v_sql text;
  v_original text;
begin
  select pg_get_functiondef(
    'public.ai_ops_refresh_sop_observations(uuid,timestamptz)'::regprocedure
  ) into v_sql;
  v_original := v_sql;

  if position('(b.claim_id is null) as violation' in v_sql) = 0 then
    raise exception 'Unexpected AI Ops SOP baseline: claim violation expression not found';
  end if;

  v_sql := replace(
    v_sql,
    '(b.claim_id is null) as violation',
    '(b.claim_state not in (''exception'',''not_required'') and b.claim_id is null) as violation'
  );

  v_sql := replace(
    v_sql,
    '''ruleEvidence'', ''finalized billing service event should have a linked claim''',
    '''ruleEvidence'', ''finalized billing service event should have a linked claim unless Billing recorded an explicit exception or not-required outcome'''
  );

  if v_sql = v_original
     or position('(b.claim_id is null) as violation' in v_sql) > 0
     or position('b.claim_state not in (''exception'',''not_required'') and b.claim_id is null' in v_sql) = 0 then
    raise exception 'AI Ops Billing-exception patch did not match expected baseline';
  end if;

  execute v_sql;
end;
$migration$;

comment on function public.ai_ops_refresh_sop_observations(uuid,timestamptz) is
  'Refreshes source-backed deterministic SOP observations. Explicit Billing exception/not_required states are valid no-claim outcomes rather than structural handoff failures.';
