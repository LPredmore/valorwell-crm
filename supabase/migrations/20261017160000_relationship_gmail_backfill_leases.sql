-- Durable, service-role-only Gmail historical reconciliation checkpoints.
-- Progress belongs to the already open critical relationship_reconciliation_issues
-- record; the regular Gmail history cursor is NOT modified by this worker.
create or replace function public.claim_relationship_gmail_backfill(
  p_tenant_id uuid,
  p_issue_id uuid,
  p_lease_seconds integer default 90
) returns jsonb
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_details jsonb;
  v_created_at timestamptz;
  v_token uuid := gen_random_uuid();
  v_until timestamptz;
begin
  select details, created_at into v_details, v_created_at
  from public.relationship_reconciliation_issues
  where tenant_id = p_tenant_id and id = p_issue_id
    and source = 'gmail' and issue_type = 'sync_error' and status = 'open'
    and details ->> 'requires_historical_backfill' = 'true'
  for update;
  if not found then
    return jsonb_build_object('acquired',false,'reason','not_pending');
  end if;
  if nullif(v_details ->> 'backfill_lease_until','') is not null
    and (v_details ->> 'backfill_lease_until')::timestamptz > now() then
    return jsonb_build_object('acquired',false,'reason','leased');
  end if;

  v_until := now() + make_interval(secs => greatest(30,least(p_lease_seconds,180)));
  v_details := v_details || jsonb_build_object(
    'backfill_lease_token',v_token::text,
    'backfill_lease_until',v_until,
    'backfill_attempts',coalesce((v_details->>'backfill_attempts')::integer,0)+1,
    'backfill_started_at',coalesce(v_details->'backfill_started_at',to_jsonb(now()))
  );
  update public.relationship_reconciliation_issues
    set details=v_details, updated_at=now()
  where id=p_issue_id and tenant_id=p_tenant_id;
  return jsonb_build_object(
    'acquired',true, 'leaseToken',v_token::text, 'issueCreatedAt',v_created_at,
    'details',v_details
  );
end
$fn$;

create or replace function public.checkpoint_relationship_gmail_backfill(
  p_tenant_id uuid,
  p_issue_id uuid,
  p_lease_token text,
  p_next_page_token text,
  p_has_more boolean,
  p_scanned integer,
  p_matched integer,
  p_ambiguous integer,
  p_unavailable integer
) returns jsonb
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_details jsonb;
  v_batch_count integer;
  v_scanned integer;
  v_matched integer;
  v_ambiguous integer;
  v_unavailable integer;
begin
  select details into v_details
  from public.relationship_reconciliation_issues
  where tenant_id=p_tenant_id and id=p_issue_id
    and source='gmail' and issue_type='sync_error' and status='open'
  for update;
  if not found or v_details->>'backfill_lease_token' is distinct from p_lease_token then
    raise exception 'Gmail backfill lease is missing or superseded.';
  end if;
  if p_scanned < 0 or p_scanned > 25 or p_matched < 0 or p_ambiguous < 0 or p_unavailable < 0
      or p_matched + p_ambiguous + p_unavailable > p_scanned then
    raise exception 'Gmail backfill checkpoint counts are invalid.';
  end if;
  if p_has_more and (p_next_page_token is null or length(p_next_page_token)=0) then
    raise exception 'Gmail backfill cannot checkpoint unfinished pagination without a cursor.';
  end if;

  v_batch_count := coalesce((v_details->>'backfill_batches')::integer,0)+1;
  v_scanned := coalesce((v_details->>'backfill_scanned')::integer,0)+p_scanned;
  v_matched := coalesce((v_details->>'backfill_matched')::integer,0)+p_matched;
  v_ambiguous := coalesce((v_details->>'backfill_ambiguous')::integer,0)+p_ambiguous;
  v_unavailable := coalesce((v_details->>'backfill_unavailable')::integer,0)+p_unavailable;
  v_details := (v_details - 'backfill_lease_token' - 'backfill_lease_until')
    || jsonb_build_object(
      'backfill_page_token',p_next_page_token,
      'backfill_batches',v_batch_count,
      'backfill_scanned',v_scanned,
      'backfill_matched',v_matched,
      'backfill_ambiguous',v_ambiguous,
      'backfill_unavailable',v_unavailable,
      'backfill_last_batch_at',now(),
      'backfill_last_error',null
    );
  if p_has_more then
    update public.relationship_reconciliation_issues
      set details=v_details, updated_at=now()
    where id=p_issue_id and tenant_id=p_tenant_id;
  else
    v_details := v_details || jsonb_build_object(
      'requires_historical_backfill',false,
      'backfill_scan_completed_at',now(),
      'backfill_page_token',null
    );
    update public.relationship_reconciliation_issues
      set details=v_details, status='resolved', resolved_at=now(),
        resolution='Bounded Gmail historical message scan finished. Entity-matching ambiguities remain separate open issues.',
        updated_at=now()
    where id=p_issue_id and tenant_id=p_tenant_id;
  end if;
  return jsonb_build_object(
    'complete',not p_has_more,'batches',v_batch_count,
    'scanned',v_scanned,'matched',v_matched,
    'ambiguous',v_ambiguous,'unavailable',v_unavailable
  );
end
$fn$;

create or replace function public.release_relationship_gmail_backfill(
  p_tenant_id uuid,
  p_issue_id uuid,
  p_lease_token text,
  p_error_code text
) returns jsonb
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_details jsonb;
begin
  select details into v_details
  from public.relationship_reconciliation_issues
  where tenant_id=p_tenant_id and id=p_issue_id
    and source='gmail' and issue_type='sync_error' and status='open'
  for update;
  if not found or v_details->>'backfill_lease_token' is distinct from p_lease_token then
    return jsonb_build_object('released',false);
  end if;
  v_details := (v_details - 'backfill_lease_token' - 'backfill_lease_until')
    || jsonb_build_object('backfill_last_error',left(coalesce(p_error_code,'unknown'),80),
                          'backfill_last_failure_at',now());
  update public.relationship_reconciliation_issues
    set details=v_details,updated_at=now()
  where id=p_issue_id and tenant_id=p_tenant_id;
  return jsonb_build_object('released',true);
end
$fn$;

-- These privileged RPCs must never be callable by browser sessions.
revoke all on function public.claim_relationship_gmail_backfill(uuid,uuid,integer) from public,anon,authenticated;
revoke all on function public.checkpoint_relationship_gmail_backfill(uuid,uuid,text,text,boolean,integer,integer,integer,integer) from public,anon,authenticated;
revoke all on function public.release_relationship_gmail_backfill(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.claim_relationship_gmail_backfill(uuid,uuid,integer) to service_role;
grant execute on function public.checkpoint_relationship_gmail_backfill(uuid,uuid,text,text,boolean,integer,integer,integer,integer) to service_role;
grant execute on function public.release_relationship_gmail_backfill(uuid,uuid,text,text) to service_role;
