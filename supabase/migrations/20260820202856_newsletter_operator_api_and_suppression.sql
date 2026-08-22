-- Canonical newsletter operator API and always-on marketing suppression.
-- Delivery remains PRELAUNCH and cannot be scheduled by these changes.

create or replace function public.crm_upsert_newsletter(
  p_newsletter_id uuid,p_name text,p_subject text,p_preheader text,p_body_html text,p_body_text text,
  p_audience_domains text[],p_reason text
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_context jsonb:=private.relationship_campaign_context(true);
  v_tenant uuid:=(v_context->>'tenant_id')::uuid;
  v_profile uuid:=(v_context->>'actor_id')::uuid;
  v_domains text[]:=coalesce(p_audience_domains,array['client']::text[]);
  v_existing public.crm_newsletters; v_id uuid; v_created boolean:=false;
begin
  if coalesce(btrim(p_reason),'')='' then raise exception 'A reason is required to create or change a newsletter'; end if;
  if coalesce(btrim(p_name),'')='' then raise exception 'A newsletter needs a name'; end if;
  if array_length(v_domains,1) is null then raise exception 'Select at least one audience for this newsletter'; end if;
  if exists(select 1 from unnest(v_domains)d where d not in('client','staff','donor','bty')) then
    raise exception 'Unsupported newsletter audience selected. Supported audiences are client, staff, donor, and bty.';
  end if;
  if p_newsletter_id is null then
    insert into public.crm_newsletters(tenant_id,name,subject,preheader,body_html,body_text,audience_domains,status,created_by_profile_id,metadata)
    values(v_tenant,btrim(p_name),nullif(btrim(coalesce(p_subject,'')),''),nullif(btrim(coalesce(p_preheader,'')),''),
           nullif(p_body_html,''),nullif(p_body_text,''),v_domains,'draft',v_profile,jsonb_build_object('contentSource','legacy_composer'))
    returning id into v_id; v_created:=true;
  else
    select * into v_existing from public.crm_newsletters where id=p_newsletter_id and tenant_id=v_tenant;
    if v_existing.id is null then raise exception 'Newsletter not found for this tenant'; end if;
    if v_existing.status<>'draft' then raise exception 'Only a draft newsletter can be edited'; end if;
    if v_existing.editor_document is not null then raise exception 'Canonical newsletter drafts must be edited through Email Studio'; end if;
    update public.crm_newsletters set name=btrim(p_name),subject=nullif(btrim(coalesce(p_subject,'')),''),
      preheader=nullif(btrim(coalesce(p_preheader,'')),''),body_html=nullif(p_body_html,''),body_text=nullif(p_body_text,''),
      audience_domains=v_domains,metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('contentSource','legacy_composer'),updated_at=now()
    where id=v_existing.id returning id into v_id;
  end if;
  insert into public.crm_automation_events(tenant_id,event_type,subject_domain,subject_id,occurred_at,payload)
  values(v_tenant,case when v_created then 'newsletter.created' else 'newsletter.updated' end,'newsletter',v_id,now(),
         jsonb_build_object('newsletterId',v_id,'audienceDomains',to_jsonb(v_domains),'reason',btrim(p_reason),'actorProfileId',v_profile,'contentSource','legacy_composer'));
  return jsonb_build_object('newsletterId',v_id,'created',v_created,'canonical',false);
end;$$;

create or replace function public.crm_upsert_newsletter_canonical(
  p_newsletter_id uuid,p_name text,p_subject text,p_content jsonb,p_audience_domains text[],p_reason text,p_template_version_id uuid default null
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_context jsonb:=private.relationship_campaign_context(true); v_tenant uuid:=(v_context->>'tenant_id')::uuid;
  v_profile uuid:=(v_context->>'actor_id')::uuid; v_domains text[]:=coalesce(p_audience_domains,array['client']::text[]);
  v_existing public.crm_newsletters; v_id uuid; v_created boolean:=false; v_schema integer; v_doc jsonb;
  v_html text; v_text text; v_preheader text; v_theme text; v_hash text;
begin
  if coalesce(btrim(p_reason),'')='' then raise exception 'A reason is required to create or change a newsletter'; end if;
  if coalesce(btrim(p_name),'')='' then raise exception 'A newsletter needs a name'; end if;
  if coalesce(btrim(p_subject),'')='' then raise exception 'A newsletter needs a subject'; end if;
  if array_length(v_domains,1) is null then raise exception 'Select at least one audience for this newsletter'; end if;
  if exists(select 1 from unnest(v_domains)d where d not in('client','staff','donor','bty')) then
    raise exception 'Unsupported newsletter audience selected. Supported audiences are client, staff, donor, and bty.';
  end if;
  if p_content is null or coalesce(p_content->>'mode','')<>'newsletter' then raise exception 'Canonical marketing newsletter content in newsletter mode is required'; end if;
  v_schema:=nullif(p_content->>'schemaVersion','')::integer; v_doc:=p_content->'editorDocument';
  v_html:=nullif(p_content->>'renderedHtml',''); v_text:=nullif(p_content->>'renderedText','');
  v_preheader:=nullif(btrim(coalesce(p_content->>'preheader','')),''); v_theme:=nullif(btrim(coalesce(p_content->>'themeKey','')),'');
  v_hash:=nullif(btrim(coalesce(p_content->>'renderHash','')),'');
  if v_schema is null or v_schema<1 or v_doc is null or jsonb_typeof(v_doc)<>'object' or v_doc->>'type'<>'doc'
     or jsonb_typeof(v_doc->'content')<>'array' or v_html is null or v_text is null or v_theme is null or v_hash is null
     or v_hash!~'^(sha256:[0-9a-f]{64}|fnv1a32:[0-9a-f]{8})$' then
    raise exception 'Canonical Email Studio content is incomplete or invalid';
  end if;
  if p_template_version_id is not null and not exists(
    select 1 from public.crm_email_template_versions tv where tv.id=p_template_version_id and tv.tenant_id=v_tenant
      and tv.content_scope='marketing_newsletter' and tv.content_mode='newsletter') then
    raise exception 'Template version is not a published marketing newsletter version for this tenant';
  end if;
  if p_newsletter_id is null then
    insert into public.crm_newsletters(tenant_id,name,subject,preheader,body_html,body_text,template_version_id,audience_domains,status,
      created_by_profile_id,metadata,editor_document,editor_schema_version,theme_key,render_hash)
    values(v_tenant,btrim(p_name),btrim(p_subject),v_preheader,v_html,v_text,p_template_version_id,v_domains,'draft',v_profile,
      jsonb_build_object('contentSource','email_studio','contentScope','marketing_newsletter'),v_doc,v_schema,v_theme,v_hash)
    returning id into v_id; v_created:=true;
  else
    select * into v_existing from public.crm_newsletters where id=p_newsletter_id and tenant_id=v_tenant;
    if v_existing.id is null then raise exception 'Newsletter not found for this tenant'; end if;
    if v_existing.status<>'draft' then raise exception 'Only a draft newsletter can be edited. Revise a scheduled newsletter by cloning it to a new draft.'; end if;
    update public.crm_newsletters set name=btrim(p_name),subject=btrim(p_subject),preheader=v_preheader,body_html=v_html,body_text=v_text,
      template_version_id=p_template_version_id,audience_domains=v_domains,editor_document=v_doc,editor_schema_version=v_schema,
      theme_key=v_theme,render_hash=v_hash,metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('contentSource','email_studio','contentScope','marketing_newsletter'),updated_at=now()
    where id=v_existing.id returning id into v_id;
  end if;
  insert into public.crm_automation_events(tenant_id,event_type,subject_domain,subject_id,occurred_at,payload)
  values(v_tenant,case when v_created then 'newsletter.created' else 'newsletter.updated' end,'newsletter',v_id,now(),
    jsonb_build_object('newsletterId',v_id,'audienceDomains',to_jsonb(v_domains),'reason',btrim(p_reason),'actorProfileId',v_profile,'contentSource','email_studio','renderHash',v_hash));
  return jsonb_build_object('newsletterId',v_id,'created',v_created,'canonical',true,'renderHash',v_hash);
end;$$;

create or replace function public.crm_suppress_newsletter_mailbox(p_email text,p_reason text,p_source text default 'operator')
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_context jsonb:=private.relationship_campaign_context(true); v_tenant uuid:=(v_context->>'tenant_id')::uuid;
  v_profile uuid:=(v_context->>'actor_id')::uuid; v_mailbox text:=public.newsletter_mailbox_key(p_email);
  v_reason_code text:=private.crm_newsletter_reason_code(coalesce(nullif(btrim(p_source),''),'operator'));
begin
  if v_mailbox is null then raise exception 'A valid email address is required to unsubscribe a mailbox'; end if;
  if coalesce(btrim(p_reason),'')='' then raise exception 'A reason is required to unsubscribe a mailbox'; end if;
  insert into public.crm_newsletter_suppressions(tenant_id,mailbox_key,example_email,reason,reason_code,source,created_by_profile_id,revoked_at,revoked_by_profile_id,revocation_reason)
  values(v_tenant,v_mailbox,lower(btrim(p_email)),btrim(p_reason),v_reason_code,coalesce(nullif(btrim(p_source),''),'operator'),v_profile,null,null,null)
  on conflict(tenant_id,mailbox_key) do update set reason=excluded.reason,reason_code=excluded.reason_code,source=excluded.source,
    example_email=coalesce(public.crm_newsletter_suppressions.example_email,excluded.example_email),revoked_at=null,revoked_by_profile_id=null,revocation_reason=null,updated_at=now();
  update public.crm_newsletter_recipients set status='suppressed',suppression_reason=btrim(p_reason),claim_token=null,claimed_at=null,updated_at=now()
  where tenant_id=v_tenant and mailbox_key=v_mailbox and status in('pending','queued','processing');
  insert into public.crm_activity_events(tenant_id,event_type,created_by_profile_id,metadata)
  values(v_tenant,'newsletter_mailbox_suppressed',v_profile,jsonb_build_object('mailboxKey',v_mailbox,'reason',btrim(p_reason),'reasonCode',v_reason_code,'source',coalesce(nullif(btrim(p_source),''),'operator')));
  return jsonb_build_object('mailboxKey',v_mailbox,'reasonCode',v_reason_code,'active',true);
end;$$;

create or replace function public.crm_unsuppress_newsletter_mailbox(p_email text,p_reason text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_context jsonb:=private.relationship_campaign_context(true); v_tenant uuid:=(v_context->>'tenant_id')::uuid;
  v_profile uuid:=(v_context->>'actor_id')::uuid; v_mailbox text:=public.newsletter_mailbox_key(p_email); v_changed integer:=0;
begin
  if v_mailbox is null then raise exception 'A valid email address is required'; end if;
  if coalesce(btrim(p_reason),'')='' then raise exception 'A reason is required to restore newsletter eligibility'; end if;
  update public.crm_newsletter_suppressions set revoked_at=now(),revoked_by_profile_id=v_profile,revocation_reason=btrim(p_reason),updated_at=now()
  where tenant_id=v_tenant and mailbox_key=v_mailbox and revoked_at is null; get diagnostics v_changed=row_count;
  if v_changed>0 then insert into public.crm_activity_events(tenant_id,event_type,created_by_profile_id,metadata)
    values(v_tenant,'newsletter_mailbox_unsuppressed',v_profile,jsonb_build_object('mailboxKey',v_mailbox,'reason',btrim(p_reason))); end if;
  return jsonb_build_object('mailboxKey',v_mailbox,'changed',v_changed>0);
end;$$;

create or replace function public.crm_issue_newsletter_unsubscribe_token(p_recipient_id uuid)
returns text language plpgsql security definer set search_path=''
as $$
declare v_recipient public.crm_newsletter_recipients; v_existing private.crm_newsletter_unsubscribe_tokens; v_token text;
begin
  select * into v_recipient from public.crm_newsletter_recipients where id=p_recipient_id;
  if v_recipient.id is null then raise exception 'Newsletter recipient not found' using errcode='42501'; end if;
  select * into v_existing from private.crm_newsletter_unsubscribe_tokens where recipient_id=v_recipient.id;
  if v_existing.id is not null and v_existing.delivery_token is not null and v_existing.expires_at>now() then return v_existing.delivery_token; end if;
  v_token:=encode(extensions.gen_random_bytes(24),'hex');
  insert into private.crm_newsletter_unsubscribe_tokens(token_hash,delivery_token,tenant_id,newsletter_id,recipient_id,mailbox_key,delivery_email,expires_at,used_at)
  values(encode(extensions.digest(v_token,'sha256'),'hex'),v_token,v_recipient.tenant_id,v_recipient.newsletter_id,v_recipient.id,v_recipient.mailbox_key,v_recipient.recipient_email,now()+interval '2 years',null)
  on conflict(recipient_id) do update set token_hash=excluded.token_hash,delivery_token=excluded.delivery_token,mailbox_key=excluded.mailbox_key,
    delivery_email=excluded.delivery_email,expires_at=excluded.expires_at,used_at=null,updated_at=now();
  return v_token;
end;$$;

create or replace function public.crm_process_newsletter_unsubscribe(p_token text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_token private.crm_newsletter_unsubscribe_tokens%rowtype; v_already boolean;
begin
  if nullif(btrim(p_token),'') is null then return jsonb_build_object('outcome','invalid_token'); end if;
  select * into v_token from private.crm_newsletter_unsubscribe_tokens where token_hash=encode(extensions.digest(btrim(p_token),'sha256'),'hex');
  if not found then return jsonb_build_object('outcome','invalid_token'); end if;
  if v_token.expires_at<now() then return jsonb_build_object('outcome','expired_token'); end if;
  select exists(select 1 from public.crm_newsletter_suppressions where tenant_id=v_token.tenant_id and mailbox_key=v_token.mailbox_key and revoked_at is null) into v_already;
  insert into public.crm_newsletter_suppressions(tenant_id,mailbox_key,example_email,reason,reason_code,source,revoked_at,revoked_by_profile_id,revocation_reason)
  values(v_token.tenant_id,v_token.mailbox_key,v_token.delivery_email,'Newsletter unsubscribe link','unsubscribe','unsubscribe_link',null,null,null)
  on conflict(tenant_id,mailbox_key) do update set reason='Newsletter unsubscribe link',reason_code='unsubscribe',source='unsubscribe_link',revoked_at=null,revoked_by_profile_id=null,revocation_reason=null,updated_at=now();
  update public.crm_newsletter_recipients set status='suppressed',suppression_reason='Newsletter unsubscribe link',claim_token=null,claimed_at=null,updated_at=now()
  where tenant_id=v_token.tenant_id and mailbox_key=v_token.mailbox_key and status in('pending','queued','processing');
  update private.crm_newsletter_unsubscribe_tokens set used_at=coalesce(used_at,now()),updated_at=now() where id=v_token.id;
  insert into public.crm_activity_events(tenant_id,event_type,metadata)
  values(v_token.tenant_id,'newsletter_mailbox_suppressed',jsonb_build_object('mailboxKey',v_token.mailbox_key,'newsletterId',v_token.newsletter_id,'reasonCode','unsubscribe','source','unsubscribe_link'));
  return jsonb_build_object('outcome',case when v_already then 'already_unsubscribed' else 'unsubscribed' end);
end;$$;

create or replace function public.crm_newsletter_audience_preview(p_audience_domains text[],p_sample_limit integer default 10)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_context jsonb:=private.relationship_campaign_context(false); v_tenant uuid:=(v_context->>'tenant_id')::uuid;
  v_domains text[]:=coalesce(p_audience_domains,array[]::text[]); v_limit integer:=least(greatest(coalesce(p_sample_limit,10),1),50); v_result jsonb;
begin
  if exists(select 1 from unnest(v_domains)d where d not in('client','staff','donor','bty')) then
    raise exception 'Unsupported newsletter audience selected. Supported audiences are client, staff, donor, and bty.'; end if;
  if array_length(v_domains,1) is null then return jsonb_build_object('uniqueMailboxes',0,'suppressedMailboxes',0,'deliverableMailboxes',0,'overlapMailboxes',0,'byDomain','{}'::jsonb,'sample','[]'::jsonb); end if;
  with candidates as(
    select c.audience_domain,c.candidate_email,public.newsletter_mailbox_key(c.candidate_email) mailbox_key
    from private.crm_newsletter_candidates(v_tenant,v_domains)c where public.newsletter_mailbox_key(c.candidate_email) is not null),
  grouped as(select mailbox_key,min(candidate_email)delivery_email,array_agg(distinct audience_domain)qualifying_audiences from candidates group by mailbox_key),
  resolved as(select g.*,s.mailbox_key is not null is_suppressed from grouped g left join public.crm_newsletter_suppressions s
    on s.tenant_id=v_tenant and s.mailbox_key=g.mailbox_key and s.revoked_at is null)
  select jsonb_build_object('uniqueMailboxes',(select count(*)from resolved),'suppressedMailboxes',(select count(*)from resolved where is_suppressed),
    'deliverableMailboxes',(select count(*)from resolved where not is_suppressed),'overlapMailboxes',(select count(*)from resolved where array_length(qualifying_audiences,1)>1),
    'byDomain',coalesce((select jsonb_object_agg(d.domain,d.count)from(select unnest(qualifying_audiences)domain,count(*)count from resolved group by 1)d),'{}'::jsonb),
    'sample',coalesce((select jsonb_agg(jsonb_build_object('email',s.delivery_email,'audiences',to_jsonb(s.qualifying_audiences),'suppressed',s.is_suppressed)order by s.delivery_email)
      from(select * from resolved order by delivery_email limit v_limit)s),'[]'::jsonb)) into v_result;
  return v_result;
end;$$;

create or replace function public.crm_get_newsletter(p_newsletter_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_context jsonb:=private.relationship_campaign_context(false); v_tenant uuid:=(v_context->>'tenant_id')::uuid; v_result jsonb;
begin
  select jsonb_build_object('id',n.id,'name',n.name,'subject',n.subject,'preheader',n.preheader,'bodyHtml',n.body_html,'bodyText',n.body_text,
    'editorDocument',n.editor_document,'schemaVersion',n.editor_schema_version,'themeKey',n.theme_key,'renderHash',n.render_hash,
    'templateVersionId',n.template_version_id,'canonical',n.editor_document is not null,'audienceDomains',to_jsonb(n.audience_domains),'status',n.status,
    'scheduledAt',n.scheduled_at,'startedAt',n.started_at,'completedAt',n.completed_at,'updatedAt',n.updated_at,
    'recipientCounts',coalesce((select jsonb_object_agg(t.status,t.count)from(select r.status,count(*)count from public.crm_newsletter_recipients r where r.newsletter_id=n.id group by r.status)t),'{}'::jsonb))
  into v_result from public.crm_newsletters n where n.id=p_newsletter_id and n.tenant_id=v_tenant;
  if v_result is null then raise exception 'Newsletter not found for this tenant'; end if; return v_result;
end;$$;

create or replace function public.crm_list_newsletters()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_context jsonb:=private.relationship_campaign_context(false); v_tenant uuid:=(v_context->>'tenant_id')::uuid;
begin
  return jsonb_build_object('newsletters',coalesce((select jsonb_agg(jsonb_build_object(
    'id',n.id,'name',n.name,'subject',n.subject,'status',n.status,'canonical',n.editor_document is not null,'audienceDomains',n.audience_domains,'scheduledAt',n.scheduled_at,
    'queued',(select count(*)from public.crm_newsletter_recipients r where r.newsletter_id=n.id and r.status in('pending','queued')),
    'processing',(select count(*)from public.crm_newsletter_recipients r where r.newsletter_id=n.id and r.status='processing'),
    'sent',(select count(*)from public.crm_newsletter_recipients r where r.newsletter_id=n.id and r.status='sent'),
    'failed',(select count(*)from public.crm_newsletter_recipients r where r.newsletter_id=n.id and r.status='failed'),
    'suppressed',(select count(*)from public.crm_newsletter_recipients r where r.newsletter_id=n.id and r.status='suppressed'),
    'skipped',(select count(*)from public.crm_newsletter_recipients r where r.newsletter_id=n.id and r.status='skipped'),'updatedAt',n.updated_at)order by n.updated_at desc)
    from public.crm_newsletters n where n.tenant_id=v_tenant),'[]'::jsonb),
    'suppressedMailboxes',(select count(*)from public.crm_newsletter_suppressions s where s.tenant_id=v_tenant and s.revoked_at is null));
end;$$;

revoke all on function public.crm_upsert_newsletter(uuid,text,text,text,text,text,text[],text) from public,anon;
grant execute on function public.crm_upsert_newsletter(uuid,text,text,text,text,text,text[],text) to authenticated,service_role;
revoke all on function public.crm_upsert_newsletter_canonical(uuid,text,text,jsonb,text[],text,uuid) from public,anon;
grant execute on function public.crm_upsert_newsletter_canonical(uuid,text,text,jsonb,text[],text,uuid) to authenticated,service_role;
revoke all on function public.crm_suppress_newsletter_mailbox(text,text,text) from public,anon;
grant execute on function public.crm_suppress_newsletter_mailbox(text,text,text) to authenticated,service_role;
revoke all on function public.crm_unsuppress_newsletter_mailbox(text,text) from public,anon;
grant execute on function public.crm_unsuppress_newsletter_mailbox(text,text) to authenticated,service_role;
revoke all on function public.crm_newsletter_audience_preview(text[],integer) from public,anon;
grant execute on function public.crm_newsletter_audience_preview(text[],integer) to authenticated,service_role;
revoke all on function public.crm_get_newsletter(uuid) from public,anon;
grant execute on function public.crm_get_newsletter(uuid) to authenticated,service_role;
revoke all on function public.crm_list_newsletters() from public,anon;
grant execute on function public.crm_list_newsletters() to authenticated,service_role;
revoke all on function public.crm_issue_newsletter_unsubscribe_token(uuid) from public,anon,authenticated;
grant execute on function public.crm_issue_newsletter_unsubscribe_token(uuid) to service_role;
revoke all on function public.crm_process_newsletter_unsubscribe(text) from public;
grant execute on function public.crm_process_newsletter_unsubscribe(text) to anon,authenticated,service_role;
