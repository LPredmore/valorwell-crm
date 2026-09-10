-- Newsletters are marketing email and should not share a sending identity with
-- transactional mail. Resend has no marketing/transactional flag; the separation
-- comes from sending marketing from its own verified subdomain so a marketing
-- reputation problem cannot damage delivery of password-reset-class email.
--
-- Adds an optional marketing sender. When it is set, newsletter delivery uses
-- it for both the Resend `from` header and the ledger row, so the audit trail
-- keeps matching what was actually sent. When it is empty, delivery falls back
-- to the existing transactional sender and behaviour is unchanged.

alter table public.crm_resend_email_settings
  add column if not exists marketing_from_email text,
  add column if not exists marketing_from_name text;

comment on column public.crm_resend_email_settings.marketing_from_email is
  'Optional verified marketing subdomain sender used for newsletters. Falls back to from_email when empty.';
comment on column public.crm_resend_email_settings.marketing_from_name is
  'Optional display name paired with marketing_from_email. Falls back to from_name when empty.';

create or replace function public.crm_claim_newsletter_recipients(p_newsletter_id uuid, p_limit integer DEFAULT 25)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_newsletter public.crm_newsletters;
  v_settings public.crm_resend_email_settings;
  v_claim uuid := gen_random_uuid();
  v_rows jsonb := '[]'::jsonb;
  v_recipient record;
  v_message public.crm_email_messages;
  v_message_id uuid;
  v_token text;
  v_from_email text;
  v_from_name text;
begin
  select * into v_newsletter from public.crm_newsletters where id=p_newsletter_id;
  if v_newsletter.id is null then raise exception 'Newsletter not found'; end if;
  if v_newsletter.status <> 'sending' then raise exception 'Only a sending newsletter can be claimed for delivery'; end if;
  if private.crm_newsletter_runtime_state(v_newsletter.tenant_id) <> 'ACTIVE'
     or not private.crm_control_plane_flag(v_newsletter.tenant_id,'communications_control_plane_enabled') then
    raise exception 'Newsletter delivery is not active';
  end if;

  select * into v_settings from public.crm_resend_email_settings where tenant_id=v_newsletter.tenant_id;
  if v_settings.connection_status <> 'connected' or v_settings.from_email is null or v_settings.postal_address is null then
    raise exception 'Connected Resend sender settings are required';
  end if;

  -- Marketing identity when configured, transactional sender otherwise.
  v_from_email := lower(btrim(coalesce(nullif(btrim(v_settings.marketing_from_email),''), v_settings.from_email)));
  v_from_name := coalesce(nullif(btrim(coalesce(v_settings.marketing_from_name,'')),''), v_settings.from_name);

  -- Current hard-stop state wins over the frozen audience snapshot.
  update public.crm_newsletter_recipients r
  set status='suppressed',suppression_reason=coalesce(s.reason,'Newsletter mailbox suppressed'),
      claim_token=null,claimed_at=null,updated_at=now()
  from public.crm_newsletter_suppressions s
  where r.newsletter_id=v_newsletter.id and r.status='pending'
    and s.tenant_id=r.tenant_id and s.mailbox_key=r.mailbox_key and s.revoked_at is null;

  update public.crm_newsletter_recipients r
  set status='skipped',suppression_reason='source_ineligible',error_code='source_ineligible',updated_at=now()
  where r.newsletter_id=v_newsletter.id and r.status='pending'
    and not exists (
      select 1 from private.crm_newsletter_candidates(r.tenant_id,r.qualifying_audiences) c
      where public.newsletter_mailbox_key(c.candidate_email)=r.mailbox_key
    );

  update public.crm_newsletter_recipients r
  set status='sent',sent_at=coalesce(r.sent_at,m.sent_at),claim_token=null,claimed_at=null,updated_at=now()
  from public.crm_email_messages m
  where r.newsletter_id=v_newsletter.id and r.status='pending'
    and m.newsletter_recipient_id=r.id and m.status in ('sent','delivered','delivery_delayed');

  update public.crm_newsletter_recipients
  set status='failed',error_code='max_attempts',error_message='Maximum newsletter delivery attempts reached',updated_at=now()
  where newsletter_id=v_newsletter.id and status='pending' and attempt_count>=5;

  update public.crm_newsletter_recipients r
  set status='processing',claim_token=v_claim,claimed_at=now(),attempt_count=r.attempt_count+1,
      last_attempt_at=now(),next_attempt_at=null,error_code=null,error_message=null,updated_at=now()
  where r.id in (
    select id from public.crm_newsletter_recipients
    where newsletter_id=v_newsletter.id and status='pending'
      and attempt_count<5 and (next_attempt_at is null or next_attempt_at<=now())
    order by created_at
    limit greatest(1,least(coalesce(p_limit,25),200))
    for update skip locked
  );

  for v_recipient in
    select * from public.crm_newsletter_recipients
    where newsletter_id=v_newsletter.id and claim_token=v_claim
    order by created_at
  loop
    select * into v_message from public.crm_email_messages where newsletter_recipient_id=v_recipient.id;
    if v_message.id is null then
      insert into public.crm_email_messages (
        tenant_id,client_id,newsletter_id,newsletter_recipient_id,direction,status,sender_email,recipient_email,
        reply_to_email,subject,body_html,body_text,preheader,render_hash,provider,message_class,source,occurred_at,
        template_version_id,metadata
      ) values (
        v_newsletter.tenant_id,null,v_newsletter.id,v_recipient.id,'outbound','queued',v_from_email,
        lower(btrim(v_recipient.recipient_email)),nullif(lower(btrim(coalesce(v_settings.reply_to_email,''))),''),
        v_newsletter.subject,v_newsletter.body_html,v_newsletter.body_text,v_newsletter.preheader,v_newsletter.render_hash,
        'resend','marketing_newsletter','newsletter_worker',now(),v_newsletter.template_version_id,
        jsonb_build_object('newsletterId',v_newsletter.id,'newsletterRecipientId',v_recipient.id,'mailboxKey',v_recipient.mailbox_key,
                           'qualifyingAudiences',to_jsonb(v_recipient.qualifying_audiences),'personId',v_recipient.person_id,
                           'editorSchemaVersion',v_newsletter.editor_schema_version,'themeKey',v_newsletter.theme_key)
      ) returning id into v_message_id;
    else
      v_message_id := v_message.id;
      if v_message.status not in ('sent','delivered','delivery_delayed') then
        update public.crm_email_messages
        set status='queued',error_code=null,error_message=null,failed_at=null,updated_at=now()
        where id=v_message_id;
      end if;
    end if;

    update public.crm_newsletter_recipients set email_message_id=v_message_id,updated_at=now() where id=v_recipient.id;
    v_token := public.crm_issue_newsletter_unsubscribe_token(v_recipient.id);

    v_rows := v_rows || jsonb_build_object(
      'recipientId',v_recipient.id,'emailMessageId',v_message_id,'deliveryEmail',v_recipient.recipient_email,
      'mailboxKey',v_recipient.mailbox_key,'greetingName',coalesce(v_recipient.greeting_name,'Friend'),
      'qualifyingAudiences',to_jsonb(v_recipient.qualifying_audiences),'unsubscribeToken',v_token,
      'attempt',v_recipient.attempt_count,'claimToken',v_claim
    );
  end loop;

  return jsonb_build_object('newsletterId',v_newsletter.id,'claimToken',v_claim,
    'senderEmail',v_from_email,'senderName',v_from_name,
    'replyToEmail',v_settings.reply_to_email,'postalAddress',v_settings.postal_address,
    'subject',v_newsletter.subject,'preheader',v_newsletter.preheader,'bodyHtml',v_newsletter.body_html,
    'bodyText',v_newsletter.body_text,'renderHash',v_newsletter.render_hash,'recipients',v_rows);
end;
$function$;
