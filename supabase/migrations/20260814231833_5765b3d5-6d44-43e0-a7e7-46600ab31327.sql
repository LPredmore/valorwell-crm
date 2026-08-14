-- =============================================================
-- PHASE 20 — newsletter ↔ email ledger linkage
-- =============================================================
alter table public.crm_email_messages
  add column if not exists newsletter_id uuid references public.crm_newsletters(id) on delete set null,
  add column if not exists newsletter_recipient_id uuid references public.crm_newsletter_recipients(id) on delete set null;

create unique index if not exists crm_email_messages_newsletter_recipient_key
  on public.crm_email_messages (newsletter_recipient_id)
  where newsletter_recipient_id is not null;

create index if not exists crm_email_messages_newsletter_idx
  on public.crm_email_messages (newsletter_id, status);

-- an unsubscribe link is never invalidated: a recipient may hold several valid tokens
alter table private.crm_newsletter_unsubscribe_tokens
  drop constraint if exists crm_newsletter_unsubscribe_tokens_recipient_id_key;

create index if not exists crm_newsletter_unsubscribe_tokens_recipient_idx
  on private.crm_newsletter_unsubscribe_tokens (recipient_id);

create or replace function public.crm_issue_newsletter_unsubscribe_token(p_recipient_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient public.crm_newsletter_recipients;
  v_token text := encode(gen_random_bytes(24), 'hex');
begin
  select * into v_recipient
  from public.crm_newsletter_recipients
  where id = p_recipient_id;

  if v_recipient.id is null then
    raise exception 'Newsletter recipient not found' using errcode = '42501';
  end if;

  insert into private.crm_newsletter_unsubscribe_tokens (
    token_hash, tenant_id, newsletter_id, recipient_id, mailbox_key, delivery_email
  ) values (
    encode(digest(v_token, 'sha256'), 'hex'), v_recipient.tenant_id, v_recipient.newsletter_id,
    v_recipient.id, v_recipient.mailbox_key, v_recipient.recipient_email
  );

  return v_token;
end;
$$;

-- -------------------------------------------------------------
-- claim a batch of recipients and open their ledger records
-- -------------------------------------------------------------
create or replace function public.crm_claim_newsletter_recipients(
  p_newsletter_id uuid,
  p_limit integer default 25
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_newsletter public.crm_newsletters;
  v_settings public.crm_resend_email_settings;
  v_claim uuid := gen_random_uuid();
  v_rows jsonb := '[]'::jsonb;
  v_recipient record;
  v_message_id uuid;
  v_token text;
begin
  select * into v_newsletter from public.crm_newsletters where id = p_newsletter_id;
  if v_newsletter.id is null then
    raise exception 'Newsletter not found';
  end if;
  if v_newsletter.status not in ('scheduled', 'sending') then
    raise exception 'Only a scheduled or sending newsletter can be claimed for delivery';
  end if;
  if not private.crm_control_plane_flag(v_newsletter.tenant_id, 'universal_newsletters_enabled') then
    raise exception 'The universal_newsletters_enabled switch must be on before sending a newsletter';
  end if;

  select * into v_settings
  from public.crm_resend_email_settings
  where tenant_id = v_newsletter.tenant_id;
  if v_settings.from_email is null then
    raise exception 'Configure the Resend sender address before sending a newsletter';
  end if;

  update public.crm_newsletter_recipients r
  set status = 'processing',
      claim_token = v_claim,
      claimed_at = now(),
      attempt_count = r.attempt_count + 1,
      error_code = null,
      updated_at = now()
  where r.id in (
    select id from public.crm_newsletter_recipients
    where newsletter_id = v_newsletter.id and status = 'pending'
    order by created_at
    limit greatest(1, least(coalesce(p_limit, 25), 200))
    for update skip locked
  );

  for v_recipient in
    select * from public.crm_newsletter_recipients
    where newsletter_id = v_newsletter.id and claim_token = v_claim
    order by created_at
  loop
    -- one ledger record per recipient, reused across retries
    select id into v_message_id
    from public.crm_email_messages
    where newsletter_recipient_id = v_recipient.id;

    if v_message_id is null then
      insert into public.crm_email_messages (
        tenant_id, client_id, newsletter_id, newsletter_recipient_id, direction, status,
        sender_email, recipient_email, reply_to_email, subject, body_html, body_text,
        provider, message_class, source, occurred_at, template_version_id, metadata
      ) values (
        v_newsletter.tenant_id,
        null,
        v_newsletter.id,
        v_recipient.id,
        'outbound',
        'queued',
        lower(btrim(v_settings.from_email)),
        lower(btrim(v_recipient.recipient_email)),
        nullif(lower(btrim(coalesce(v_settings.reply_to_email, ''))), ''),
        v_newsletter.subject,
        v_newsletter.body_html,
        v_newsletter.body_text,
        'resend',
        'marketing_newsletter',
        'newsletter_worker',
        now(),
        v_newsletter.template_version_id,
        jsonb_build_object(
          'newsletterId', v_newsletter.id,
          'newsletterRecipientId', v_recipient.id,
          'mailboxKey', v_recipient.mailbox_key,
          'qualifyingAudiences', to_jsonb(v_recipient.qualifying_audiences),
          'personId', v_recipient.person_id
        )
      )
      returning id into v_message_id;
    else
      update public.crm_email_messages
      set status = 'queued', error_code = null, error_message = null, failed_at = null, updated_at = now()
      where id = v_message_id;
    end if;

    update public.crm_newsletter_recipients
    set email_message_id = v_message_id, updated_at = now()
    where id = v_recipient.id;

    v_token := public.crm_issue_newsletter_unsubscribe_token(v_recipient.id);

    v_rows := v_rows || jsonb_build_object(
      'recipientId', v_recipient.id,
      'emailMessageId', v_message_id,
      'deliveryEmail', v_recipient.recipient_email,
      'mailboxKey', v_recipient.mailbox_key,
      'greetingName', coalesce(v_recipient.greeting_name, 'Friend'),
      'qualifyingAudiences', to_jsonb(v_recipient.qualifying_audiences),
      'unsubscribeToken', v_token,
      'attempt', v_recipient.attempt_count
    );
  end loop;

  return jsonb_build_object(
    'newsletterId', v_newsletter.id,
    'claimToken', v_claim,
    'senderEmail', lower(btrim(v_settings.from_email)),
    'senderName', v_settings.from_name,
    'postalAddress', v_settings.postal_address,
    'subject', v_newsletter.subject,
    'recipients', v_rows
  );
end;
$$;

-- -------------------------------------------------------------
-- record the immediate send result
-- -------------------------------------------------------------
create or replace function public.crm_record_newsletter_send_result(
  p_recipient_id uuid,
  p_status text,
  p_provider_message_id text default null,
  p_error_code text default null,
  p_error_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient public.crm_newsletter_recipients;
begin
  if p_status not in ('sent', 'failed') then
    raise exception 'A newsletter send result must be sent or failed';
  end if;

  select * into v_recipient from public.crm_newsletter_recipients where id = p_recipient_id;
  if v_recipient.id is null then
    raise exception 'Newsletter recipient not found';
  end if;

  update public.crm_newsletter_recipients
  set status = p_status,
      sent_at = case when p_status = 'sent' then now() else sent_at end,
      error_code = case when p_status = 'failed' then p_error_code else null end,
      claim_token = null,
      updated_at = now()
  where id = v_recipient.id;

  update public.crm_email_messages
  set status = case when p_status = 'sent' then 'sent' else 'failed' end,
      provider_message_id = coalesce(nullif(btrim(coalesce(p_provider_message_id, '')), ''), provider_message_id),
      sent_at = case when p_status = 'sent' then now() else sent_at end,
      failed_at = case when p_status = 'failed' then now() else failed_at end,
      error_code = case when p_status = 'failed' then p_error_code else null end,
      error_message = case when p_status = 'failed' then p_error_message else null end,
      occurred_at = now(),
      updated_at = now()
  where newsletter_recipient_id = v_recipient.id;

  return jsonb_build_object('recipientId', v_recipient.id, 'status', p_status);
end;
$$;

-- -------------------------------------------------------------
-- record later provider outcomes against the ledger
-- -------------------------------------------------------------
create or replace function public.crm_record_newsletter_delivery_event(
  p_provider_message_id text,
  p_event text,
  p_occurred_at timestamptz default now(),
  p_error_code text default null,
  p_error_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message public.crm_email_messages;
  v_status text;
begin
  v_status := case p_event
    when 'delivered' then 'delivered'
    when 'delivery_delayed' then 'delivery_delayed'
    when 'bounced' then 'bounced'
    when 'complained' then 'complained'
    when 'failed' then 'failed'
    else null
  end;

  if v_status is null then
    return jsonb_build_object('outcome', 'ignored_event', 'event', p_event);
  end if;

  select * into v_message
  from public.crm_email_messages
  where provider_message_id = nullif(btrim(coalesce(p_provider_message_id, '')), '')
    and newsletter_recipient_id is not null;

  if v_message.id is null then
    return jsonb_build_object('outcome', 'unknown_message');
  end if;

  update public.crm_email_messages
  set status = v_status,
      delivered_at = case when v_status = 'delivered' then coalesce(p_occurred_at, now()) else delivered_at end,
      failed_at = case when v_status in ('bounced', 'complained', 'failed') then coalesce(p_occurred_at, now()) else failed_at end,
      error_code = coalesce(p_error_code, error_code),
      error_message = coalesce(p_error_message, error_message),
      occurred_at = coalesce(p_occurred_at, now()),
      updated_at = now()
  where id = v_message.id;

  update public.crm_newsletter_recipients
  set status = case when v_status in ('bounced', 'complained', 'failed') then 'failed' else status end,
      error_code = case when v_status in ('bounced', 'complained', 'failed') then coalesce(p_error_code, v_status) else error_code end,
      updated_at = now()
  where id = v_message.newsletter_recipient_id;

  -- a hard bounce or a complaint unsubscribes the whole mailbox from newsletters only
  if v_status in ('bounced', 'complained') then
    insert into public.crm_newsletter_suppressions (
      tenant_id, mailbox_key, example_email, reason, reason_code, source
    )
    select
      r.tenant_id, r.mailbox_key, r.recipient_email,
      case when v_status = 'complained' then 'Newsletter complaint' else 'Newsletter hard bounce' end,
      case when v_status = 'complained' then 'complaint' else 'hard_bounce' end,
      case when v_status = 'complained' then 'complaint' else 'bounce' end
    from public.crm_newsletter_recipients r
    where r.id = v_message.newsletter_recipient_id
    on conflict (tenant_id, mailbox_key) do nothing;
  end if;

  insert into public.crm_activity_events (tenant_id, event_type, metadata)
  values (
    v_message.tenant_id, 'newsletter_delivery_event',
    jsonb_build_object(
      'newsletterId', v_message.newsletter_id,
      'newsletterRecipientId', v_message.newsletter_recipient_id,
      'emailMessageId', v_message.id,
      'event', p_event,
      'status', v_status
    )
  );

  return jsonb_build_object('outcome', 'recorded', 'status', v_status, 'emailMessageId', v_message.id);
end;
$$;

-- -------------------------------------------------------------
-- traceability report: recipient → ledger → outcome
-- -------------------------------------------------------------
create or replace function public.crm_newsletter_delivery_trace(
  p_newsletter_id uuid,
  p_limit integer default 200
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_context jsonb := private.relationship_campaign_context(false);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
begin
  if not exists (
    select 1 from public.crm_newsletters where id = p_newsletter_id and tenant_id = v_tenant
  ) then
    raise exception 'Newsletter not found for this tenant';
  end if;

  return jsonb_build_object(
    'newsletterId', p_newsletter_id,
    'summary', coalesce((
      select jsonb_agg(jsonb_build_object('status', s.status, 'count', s.total) order by s.status)
      from (
        select r.status, count(*) as total
        from public.crm_newsletter_recipients r
        where r.newsletter_id = p_newsletter_id and r.tenant_id = v_tenant
        group by r.status
      ) s
    ), '[]'::jsonb),
    'recipients', coalesce((
      select jsonb_agg(row order by row->>'deliveryEmail')
      from (
        select jsonb_build_object(
          'recipientId', r.id,
          'deliveryEmail', r.recipient_email,
          'mailboxKey', r.mailbox_key,
          'personId', r.person_id,
          'qualifyingAudiences', to_jsonb(r.qualifying_audiences),
          'sourceMemberships', r.source_memberships,
          'recipientStatus', r.status,
          'suppressionReason', r.suppression_reason,
          'attemptCount', r.attempt_count,
          'errorCode', r.error_code,
          'emailMessageId', m.id,
          'ledgerStatus', m.status,
          'providerMessageId', m.provider_message_id,
          'sentAt', m.sent_at,
          'deliveredAt', m.delivered_at,
          'failedAt', m.failed_at,
          'errorMessage', m.error_message
        ) as row
        from public.crm_newsletter_recipients r
        left join public.crm_email_messages m on m.newsletter_recipient_id = r.id
        where r.newsletter_id = p_newsletter_id and r.tenant_id = v_tenant
        order by r.recipient_email
        limit greatest(1, least(coalesce(p_limit, 200), 1000))
      ) rows
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.crm_claim_newsletter_recipients(uuid, integer) from public;
revoke all on function public.crm_record_newsletter_send_result(uuid, text, text, text, text) from public;
revoke all on function public.crm_record_newsletter_delivery_event(text, text, timestamptz, text, text) from public;
grant execute on function public.crm_claim_newsletter_recipients(uuid, integer) to service_role;
grant execute on function public.crm_record_newsletter_send_result(uuid, text, text, text, text) to service_role;
grant execute on function public.crm_record_newsletter_delivery_event(text, text, timestamptz, text, text) to service_role;
grant execute on function public.crm_newsletter_delivery_trace(uuid, integer) to authenticated, service_role;
