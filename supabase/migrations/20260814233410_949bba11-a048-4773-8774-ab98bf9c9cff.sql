create or replace function public.crm_upsert_newsletter(
  p_newsletter_id uuid,
  p_name text,
  p_subject text,
  p_preheader text,
  p_body_html text,
  p_body_text text,
  p_audience_domains text[],
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_context jsonb := private.relationship_campaign_context(true);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
  v_profile uuid := (v_context->>'profile_id')::uuid;
  v_domains text[] := coalesce(p_audience_domains, array['client']::text[]);
  v_existing public.crm_newsletters;
  v_id uuid;
  v_created boolean := false;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A reason is required to create or change a newsletter';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'A newsletter needs a name';
  end if;
  if array_length(v_domains, 1) is null then
    raise exception 'Select at least one audience for this newsletter';
  end if;
  if exists (
    select 1 from unnest(v_domains) d
    where d not in ('client', 'staff', 'donor', 'relationship', 'bty', 'provider_applicant')
  ) then
    raise exception 'Unsupported newsletter audience selected';
  end if;

  if p_newsletter_id is null then
    insert into public.crm_newsletters (
      tenant_id, name, subject, preheader, body_html, body_text,
      audience_domains, status, created_by_profile_id
    ) values (
      v_tenant, btrim(p_name), nullif(btrim(coalesce(p_subject, '')), ''),
      nullif(btrim(coalesce(p_preheader, '')), ''),
      nullif(p_body_html, ''), nullif(p_body_text, ''),
      v_domains, 'draft', v_profile
    )
    returning id into v_id;
    v_created := true;
  else
    select * into v_existing
    from public.crm_newsletters
    where id = p_newsletter_id and tenant_id = v_tenant;
    if v_existing.id is null then
      raise exception 'Newsletter not found for this tenant';
    end if;
    if v_existing.status not in ('draft', 'scheduled') then
      raise exception 'Only a draft or scheduled newsletter can be edited';
    end if;

    update public.crm_newsletters
    set name = btrim(p_name),
        subject = nullif(btrim(coalesce(p_subject, '')), ''),
        preheader = nullif(btrim(coalesce(p_preheader, '')), ''),
        body_html = nullif(p_body_html, ''),
        body_text = nullif(p_body_text, ''),
        audience_domains = v_domains,
        updated_at = now()
    where id = v_existing.id
    returning id into v_id;
  end if;

  insert into public.crm_automation_events (
    tenant_id, event_type, subject_domain, subject_id, occurred_at, payload
  ) values (
    v_tenant,
    case when v_created then 'newsletter.created' else 'newsletter.updated' end,
    'newsletter',
    v_id,
    now(),
    jsonb_build_object(
      'newsletterId', v_id,
      'audienceDomains', to_jsonb(v_domains),
      'reason', btrim(p_reason),
      'actorProfileId', v_profile
    )
  );

  return jsonb_build_object('newsletterId', v_id, 'created', v_created);
end;
$function$;

create or replace function public.crm_get_newsletter(p_newsletter_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_context jsonb := private.relationship_campaign_context(true);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
  v_result jsonb;
begin
  select jsonb_build_object(
    'id', n.id,
    'name', n.name,
    'subject', n.subject,
    'preheader', n.preheader,
    'bodyHtml', n.body_html,
    'bodyText', n.body_text,
    'audienceDomains', to_jsonb(n.audience_domains),
    'status', n.status,
    'scheduledAt', n.scheduled_at,
    'startedAt', n.started_at,
    'completedAt', n.completed_at,
    'updatedAt', n.updated_at,
    'recipientCounts', coalesce((
      select jsonb_object_agg(t.status, t.count)
      from (
        select r.status, count(*) as count
        from public.crm_newsletter_recipients r
        where r.newsletter_id = n.id
        group by r.status
      ) t
    ), '{}'::jsonb)
  )
  into v_result
  from public.crm_newsletters n
  where n.id = p_newsletter_id and n.tenant_id = v_tenant;

  if v_result is null then
    raise exception 'Newsletter not found for this tenant';
  end if;
  return v_result;
end;
$function$;

create or replace function public.crm_newsletter_audience_preview(
  p_audience_domains text[],
  p_sample_limit integer default 10
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_context jsonb := private.relationship_campaign_context(true);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
  v_domains text[] := coalesce(p_audience_domains, array[]::text[]);
  v_limit integer := least(greatest(coalesce(p_sample_limit, 10), 1), 50);
  v_result jsonb;
begin
  if array_length(v_domains, 1) is null then
    return jsonb_build_object(
      'uniqueMailboxes', 0, 'suppressedMailboxes', 0, 'deliverableMailboxes', 0,
      'overlapMailboxes', 0, 'byDomain', '{}'::jsonb, 'sample', '[]'::jsonb
    );
  end if;

  with candidates as (
    select
      c.audience_domain,
      c.candidate_email,
      public.newsletter_mailbox_key(c.candidate_email) as mailbox_key
    from private.crm_newsletter_candidates(v_tenant, v_domains) c
    where public.newsletter_mailbox_key(c.candidate_email) is not null
  ), grouped as (
    select
      mailbox_key,
      min(candidate_email) as delivery_email,
      array_agg(distinct audience_domain) as qualifying_audiences
    from candidates
    group by mailbox_key
  ), resolved as (
    select g.*, s.mailbox_key is not null as is_suppressed
    from grouped g
    left join public.crm_newsletter_suppressions s
      on s.tenant_id = v_tenant and s.mailbox_key = g.mailbox_key
  )
  select jsonb_build_object(
    'uniqueMailboxes', (select count(*) from resolved),
    'suppressedMailboxes', (select count(*) from resolved where is_suppressed),
    'deliverableMailboxes', (select count(*) from resolved where not is_suppressed),
    'overlapMailboxes', (select count(*) from resolved where array_length(qualifying_audiences, 1) > 1),
    'byDomain', coalesce((
      select jsonb_object_agg(d.domain, d.count)
      from (
        select unnest(qualifying_audiences) as domain, count(*) as count
        from resolved
        group by 1
      ) d
    ), '{}'::jsonb),
    'sample', coalesce((
      select jsonb_agg(jsonb_build_object(
        'email', s.delivery_email,
        'audiences', to_jsonb(s.qualifying_audiences),
        'suppressed', s.is_suppressed
      ) order by s.delivery_email)
      from (select * from resolved order by delivery_email limit v_limit) s
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;

revoke all on function public.crm_upsert_newsletter(uuid, text, text, text, text, text, text[], text) from public;
revoke all on function public.crm_get_newsletter(uuid) from public;
revoke all on function public.crm_newsletter_audience_preview(text[], integer) from public;

grant execute on function public.crm_upsert_newsletter(uuid, text, text, text, text, text, text[], text) to authenticated;
grant execute on function public.crm_get_newsletter(uuid) to authenticated;
grant execute on function public.crm_newsletter_audience_preview(text[], integer) to authenticated;