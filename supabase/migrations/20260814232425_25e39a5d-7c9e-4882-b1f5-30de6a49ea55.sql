-- =========================================================
-- Newsletter send-run controls for the server-side worker
-- =========================================================

-- ---------------------------------------------------------
-- operator: schedule a newsletter for delivery
-- ---------------------------------------------------------
create or replace function public.crm_schedule_newsletter(
  p_newsletter_id uuid,
  p_scheduled_at timestamptz,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_context jsonb := private.relationship_campaign_context(true);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
  v_profile uuid := (v_context->>'profile_id')::uuid;
  v_newsletter public.crm_newsletters;
  v_pending integer;
  v_when timestamptz := coalesce(p_scheduled_at, now());
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A reason is required to schedule a newsletter';
  end if;

  select * into v_newsletter
  from public.crm_newsletters
  where id = p_newsletter_id and tenant_id = v_tenant;
  if v_newsletter.id is null then
    raise exception 'Newsletter not found for this tenant';
  end if;
  if v_newsletter.status not in ('draft', 'scheduled') then
    raise exception 'Only a draft or scheduled newsletter can be scheduled';
  end if;
  if not private.crm_control_plane_flag(v_tenant, 'universal_newsletters_enabled') then
    raise exception 'The universal_newsletters_enabled switch must be on before scheduling a newsletter';
  end if;
  if coalesce(btrim(v_newsletter.subject), '') = '' or coalesce(btrim(v_newsletter.body_html), '') = '' then
    raise exception 'A newsletter needs a subject and body before it can be scheduled';
  end if;

  select count(*) into v_pending
  from public.crm_newsletter_recipients
  where newsletter_id = v_newsletter.id and status = 'pending';
  if v_pending = 0 then
    raise exception 'Build the recipient list before scheduling this newsletter';
  end if;

  update public.crm_newsletters
  set status = 'scheduled',
      scheduled_at = v_when,
      updated_at = now()
  where id = v_newsletter.id;

  insert into public.crm_automation_events (
    tenant_id, event_type, subject_domain, subject_id, occurred_at, payload
  ) values (
    v_tenant,
    'newsletter.scheduled',
    'newsletter',
    v_newsletter.id,
    now(),
    jsonb_build_object(
      'newsletterId', v_newsletter.id,
      'scheduledAt', v_when,
      'pendingRecipients', v_pending,
      'reason', btrim(p_reason),
      'actorProfileId', v_profile
    )
  );

  return jsonb_build_object(
    'newsletterId', v_newsletter.id,
    'status', 'scheduled',
    'scheduledAt', v_when,
    'pendingRecipients', v_pending
  );
end;
$$;

-- ---------------------------------------------------------
-- operator: stop a scheduled or in-flight send
-- ---------------------------------------------------------
create or replace function public.crm_cancel_newsletter_send(
  p_newsletter_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_context jsonb := private.relationship_campaign_context(true);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
  v_profile uuid := (v_context->>'profile_id')::uuid;
  v_newsletter public.crm_newsletters;
  v_stopped integer := 0;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A reason is required to cancel a newsletter send';
  end if;

  select * into v_newsletter
  from public.crm_newsletters
  where id = p_newsletter_id and tenant_id = v_tenant;
  if v_newsletter.id is null then
    raise exception 'Newsletter not found for this tenant';
  end if;
  if v_newsletter.status not in ('scheduled', 'sending') then
    raise exception 'Only a scheduled or sending newsletter can be cancelled';
  end if;

  -- recipients already handed to the provider keep their outcome; only
  -- untouched ones are stood down
  update public.crm_newsletter_recipients
  set status = 'skipped',
      suppression_reason = 'send_cancelled',
      claim_token = null,
      updated_at = now()
  where newsletter_id = v_newsletter.id and status = 'pending';
  get diagnostics v_stopped = row_count;

  update public.crm_newsletters
  set status = 'cancelled',
      completed_at = now(),
      updated_at = now()
  where id = v_newsletter.id;

  insert into public.crm_automation_events (
    tenant_id, event_type, subject_domain, subject_id, occurred_at, payload
  ) values (
    v_tenant,
    'newsletter.cancelled',
    'newsletter',
    v_newsletter.id,
    now(),
    jsonb_build_object(
      'newsletterId', v_newsletter.id,
      'stoodDownRecipients', v_stopped,
      'reason', btrim(p_reason),
      'actorProfileId', v_profile
    )
  );

  return jsonb_build_object(
    'newsletterId', v_newsletter.id,
    'status', 'cancelled',
    'stoodDownRecipients', v_stopped
  );
end;
$$;

-- ---------------------------------------------------------
-- worker: which newsletters are due to send right now
-- ---------------------------------------------------------
create or replace function public.crm_claim_due_newsletters(p_limit integer default 5)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows jsonb := '[]'::jsonb;
  v_row record;
begin
  for v_row in
    select n.id, n.tenant_id, n.name, n.status
    from public.crm_newsletters n
    where n.status in ('scheduled', 'sending')
      and (n.status = 'sending' or coalesce(n.scheduled_at, now()) <= now())
      and private.crm_control_plane_flag(n.tenant_id, 'universal_newsletters_enabled')
      and exists (
        select 1 from public.crm_newsletter_recipients r
        where r.newsletter_id = n.id and r.status = 'pending'
      )
    order by coalesce(n.scheduled_at, n.created_at)
    limit greatest(1, least(coalesce(p_limit, 5), 25))
    for update of n skip locked
  loop
    if v_row.status = 'scheduled' then
      update public.crm_newsletters
      set status = 'sending',
          started_at = coalesce(started_at, now()),
          updated_at = now()
      where id = v_row.id;

      insert into public.crm_automation_events (
        tenant_id, event_type, subject_domain, subject_id, occurred_at, payload
      ) values (
        v_row.tenant_id,
        'newsletter.send_started',
        'newsletter',
        v_row.id,
        now(),
        jsonb_build_object('newsletterId', v_row.id, 'name', v_row.name)
      );
    end if;

    v_rows := v_rows || jsonb_build_object(
      'newsletterId', v_row.id,
      'tenantId', v_row.tenant_id,
      'name', v_row.name
    );
  end loop;

  return jsonb_build_object('newsletters', v_rows);
end;
$$;

-- ---------------------------------------------------------
-- worker: return abandoned claims to the queue
-- ---------------------------------------------------------
create or replace function public.crm_release_stale_newsletter_claims(p_older_than_minutes integer default 15)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_released integer := 0;
  v_cutoff timestamptz := now() - make_interval(mins => greatest(1, coalesce(p_older_than_minutes, 15)));
begin
  update public.crm_newsletter_recipients
  set status = 'pending',
      claim_token = null,
      claimed_at = null,
      updated_at = now()
  where status = 'processing'
    and claimed_at is not null
    and claimed_at < v_cutoff;
  get diagnostics v_released = row_count;

  return jsonb_build_object('released', v_released);
end;
$$;

-- ---------------------------------------------------------
-- worker: close out a finished send
-- ---------------------------------------------------------
create or replace function public.crm_finalize_newsletter(p_newsletter_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_newsletter public.crm_newsletters;
  v_outstanding integer;
  v_sent integer;
  v_failed integer;
begin
  select * into v_newsletter
  from public.crm_newsletters
  where id = p_newsletter_id
  for update;
  if v_newsletter.id is null then
    raise exception 'Newsletter not found';
  end if;

  select
    count(*) filter (where status in ('pending', 'processing')),
    count(*) filter (where status = 'sent'),
    count(*) filter (where status = 'failed')
  into v_outstanding, v_sent, v_failed
  from public.crm_newsletter_recipients
  where newsletter_id = v_newsletter.id;

  if v_outstanding > 0 or v_newsletter.status <> 'sending' then
    return jsonb_build_object(
      'newsletterId', v_newsletter.id,
      'status', v_newsletter.status,
      'outstanding', v_outstanding,
      'finalized', false
    );
  end if;

  update public.crm_newsletters
  set status = 'sent',
      completed_at = now(),
      updated_at = now()
  where id = v_newsletter.id;

  insert into public.crm_automation_events (
    tenant_id, event_type, subject_domain, subject_id, occurred_at, payload
  ) values (
    v_newsletter.tenant_id,
    'newsletter.send_completed',
    'newsletter',
    v_newsletter.id,
    now(),
    jsonb_build_object(
      'newsletterId', v_newsletter.id,
      'sent', v_sent,
      'failed', v_failed
    )
  );

  return jsonb_build_object(
    'newsletterId', v_newsletter.id,
    'status', 'sent',
    'sent', v_sent,
    'failed', v_failed,
    'finalized', true
  );
end;
$$;

revoke all on function public.crm_schedule_newsletter(uuid, timestamptz, text) from public;
revoke all on function public.crm_cancel_newsletter_send(uuid, text) from public;
revoke all on function public.crm_claim_due_newsletters(integer) from public;
revoke all on function public.crm_release_stale_newsletter_claims(integer) from public;
revoke all on function public.crm_finalize_newsletter(uuid) from public;

grant execute on function public.crm_schedule_newsletter(uuid, timestamptz, text) to authenticated, service_role;
grant execute on function public.crm_cancel_newsletter_send(uuid, text) to authenticated, service_role;
grant execute on function public.crm_claim_due_newsletters(integer) to service_role;
grant execute on function public.crm_release_stale_newsletter_claims(integer) to service_role;
grant execute on function public.crm_finalize_newsletter(uuid) to service_role;