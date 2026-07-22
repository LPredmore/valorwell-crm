create or replace function public.search_relationships(
  p_query text,
  p_kinds text[] default null,
  p_page integer default 1,
  p_page_size integer default 25
)
returns jsonb
language plpgsql
stable
security invoker
set search_path to ''
as $function$
declare
  v_context jsonb;
  v_tenant_id uuid;
  v_query text := trim(coalesce(p_query, ''));
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 25), 1), 100);
  v_tsquery tsquery;
  v_result jsonb;
begin
  v_context := public.get_crm_operating_context();
  if coalesce((v_context->>'authenticated')::boolean, false) is not true
     or nullif(v_context->>'current_tenant_id', '') is null
     or coalesce(v_context->>'crm_role', 'crm_none') = 'crm_none' then
    raise exception 'Authenticated CRM tenant access is required.' using errcode = '42501';
  end if;

  v_tenant_id := (v_context->>'current_tenant_id')::uuid;

  if v_query = '' then
    return jsonb_build_object('items', '[]'::jsonb, 'total', 0, 'page', v_page, 'pageSize', v_page_size);
  end if;

  if p_kinds is not null and exists (
    select 1 from unnest(p_kinds) kind
    where kind not in ('organization','contact','opportunity','campaign')
  ) then
    raise exception 'Unsupported relationship search kind.' using errcode = '22023';
  end if;

  v_tsquery := websearch_to_tsquery('simple'::regconfig, v_query);

  with all_matches as (
    select
      organization.id,
      'organization'::text as kind,
      organization.name as label,
      nullif(concat_ws(' · ', organization.organization_kind, organization.relationship_stage, organization.website), '') as detail,
      '/crm/business-development/organizations/' || organization.id::text as route,
      (ts_rank_cd(organization.search_document, v_tsquery)
        + case when lower(organization.name) = lower(v_query) then 3 else 0 end
        + case when position(lower(v_query) in lower(organization.name)) > 0 then 0.5 else 0 end)::real as rank,
      organization.updated_at
    from public.relationship_organizations organization
    where organization.tenant_id = v_tenant_id
      and (
        organization.search_document @@ v_tsquery
        or position(lower(v_query) in lower(concat_ws(' ', organization.name, organization.website, organization.organization_kind, organization.outreach_status, organization.relationship_stage))) > 0
      )

    union all

    select
      contact.id,
      'contact'::text,
      coalesce(nullif(trim(contact.preferred_name), ''), nullif(trim(concat_ws(' ', contact.first_name, contact.last_name)), ''), contact.email, 'Unnamed contact'),
      nullif(concat_ws(' · ', contact.email, contact.state, (
        select organization.name
        from public.relationship_contact_organizations affiliation
        join public.relationship_organizations organization
          on organization.tenant_id = affiliation.tenant_id
         and organization.id = affiliation.organization_id
        where affiliation.tenant_id = contact.tenant_id
          and affiliation.contact_id = contact.id
        order by affiliation.is_primary desc, affiliation.created_at asc
        limit 1
      )), ''),
      '/crm/business-development/contacts/' || contact.id::text,
      (ts_rank_cd(contact.search_document, v_tsquery)
        + case when lower(coalesce(contact.email, '')) = lower(v_query) then 3 else 0 end
        + case when position(lower(v_query) in lower(concat_ws(' ', contact.preferred_name, contact.first_name, contact.last_name, contact.email))) > 0 then 0.5 else 0 end)::real,
      contact.updated_at
    from public.relationship_contacts contact
    where contact.tenant_id = v_tenant_id
      and (
        contact.search_document @@ v_tsquery
        or position(lower(v_query) in lower(concat_ws(' ', contact.preferred_name, contact.first_name, contact.last_name, contact.email, contact.phone, contact.state, contact.outreach_status, contact.relationship_stage))) > 0
      )

    union all

    select
      opportunity.id,
      'opportunity'::text,
      organization.name,
      nullif(concat_ws(' · ', 'BTY opportunity', opportunity.status, opportunity.cause_area, opportunity.next_action), ''),
      '/crm/business-development/opportunities/' || opportunity.id::text,
      (ts_rank_cd(opportunity.search_document, v_tsquery)
        + ts_rank_cd(organization.search_document, v_tsquery)
        + case when position(lower(v_query) in lower(organization.name)) > 0 then 1 else 0 end)::real,
      opportunity.updated_at
    from public.relationship_opportunities opportunity
    join public.relationship_organizations organization
      on organization.tenant_id = opportunity.tenant_id
     and organization.id = opportunity.organization_id
    where opportunity.tenant_id = v_tenant_id
      and (
        opportunity.search_document @@ v_tsquery
        or organization.search_document @@ v_tsquery
        or position(lower(v_query) in lower(concat_ws(' ', organization.name, opportunity.status, opportunity.cause_area, opportunity.next_action))) > 0
      )

    union all

    select
      campaign.id,
      'campaign'::text,
      campaign.name,
      nullif(concat_ws(' · ', campaign.status, campaign.initiative, left(campaign.purpose, 160)), ''),
      '/crm/business-development/campaigns/' || campaign.id::text,
      (ts_rank_cd(campaign.search_document, v_tsquery)
        + case when lower(campaign.name) = lower(v_query) then 3 else 0 end
        + case when position(lower(v_query) in lower(campaign.name)) > 0 then 0.5 else 0 end)::real,
      campaign.updated_at
    from public.relationship_campaigns campaign
    where campaign.tenant_id = v_tenant_id
      and (
        campaign.search_document @@ v_tsquery
        or position(lower(v_query) in lower(concat_ws(' ', campaign.name, campaign.purpose, campaign.initiative, campaign.sender_name, campaign.sender_email, campaign.status, campaign.marketing_lifecycle_stage))) > 0
      )
  ), filtered_matches as (
    select * from all_matches
    where p_kinds is null or cardinality(p_kinds) = 0 or kind = any(p_kinds)
  ), page_rows as (
    select * from filtered_matches
    order by rank desc, updated_at desc, label asc, id asc
    offset (v_page - 1) * v_page_size
    limit v_page_size
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', row.id,
        'kind', row.kind,
        'label', row.label,
        'detail', row.detail,
        'route', row.route
      ) order by row.rank desc, row.updated_at desc, row.label asc, row.id asc)
      from page_rows row
    ), '[]'::jsonb),
    'total', (select count(*) from filtered_matches),
    'page', v_page,
    'pageSize', v_page_size
  ) into v_result;

  return v_result;
end;
$function$;

create or replace function public.get_relationship_report_metrics(p_period jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path to ''
as $function$
declare
  v_context jsonb;
  v_tenant_id uuid;
  v_from timestamptz;
  v_to timestamptz;
  v_result jsonb;
begin
  v_context := public.get_crm_operating_context();
  if coalesce((v_context->>'authenticated')::boolean, false) is not true
     or nullif(v_context->>'current_tenant_id', '') is null
     or coalesce(((v_context->'capabilities'->>'report')::boolean), false) is not true then
    raise exception 'CRM reporting access is required.' using errcode = '42501';
  end if;

  v_tenant_id := (v_context->>'current_tenant_id')::uuid;
  v_from := coalesce(nullif(p_period->>'from', '')::timestamptz, date_trunc('day', now() - interval '30 days'));
  v_to := coalesce(nullif(p_period->>'to', '')::timestamptz, now());

  if v_from > v_to then
    raise exception 'Report period start must not be after the period end.' using errcode = '22023';
  end if;

  with metric_catalog(metric_key, label, sort_order) as (
    values
      ('organizations_needing_review'::text, 'Organizations needing review'::text, 10),
      ('opportunities_needing_qualification', 'BTY opportunities needing qualification', 20),
      ('overdue_next_actions', 'Overdue next actions', 30),
      ('unassigned_relationships', 'Unassigned relationships', 40),
      ('active_outreach_campaigns', 'Active outreach campaigns', 50),
      ('replies_requiring_staff_action', 'Replies requiring staff action', 60),
      ('import_conflicts', 'Import conflicts', 70),
      ('recently_updated_relationships', 'Recently updated relationships', 80),
      ('total_organizations', 'Total organizations', 90),
      ('total_contacts', 'Total contacts', 100),
      ('open_opportunities', 'Open BTY opportunities', 110),
      ('active_suppressions', 'Active suppressions', 120)
  ), current_metrics as (
    select catalog.metric_key, catalog.label, coalesce(metric.metric_value, 0)::numeric as metric_value, catalog.sort_order
    from metric_catalog catalog
    left join public.relationship_report_metrics_v metric
      on metric.tenant_id = v_tenant_id and metric.metric_key = catalog.metric_key
  ), period_metrics(metric_key, label, metric_value, sort_order) as (
    values
      ('period_outbound_messages'::text, 'Outbound messages in period'::text,
        (select count(*)::numeric from public.relationship_communications communication where communication.tenant_id = v_tenant_id and communication.direction = 'outbound' and communication.occurred_at >= v_from and communication.occurred_at <= v_to), 200),
      ('period_delivered_messages', 'Delivered messages in period',
        (select count(*)::numeric from public.relationship_communications communication where communication.tenant_id = v_tenant_id and communication.direction = 'outbound' and communication.status = 'delivered' and communication.occurred_at >= v_from and communication.occurred_at <= v_to), 210),
      ('period_failed_or_bounced_messages', 'Failed or bounced messages in period',
        (select count(*)::numeric from public.relationship_communications communication where communication.tenant_id = v_tenant_id and communication.direction = 'outbound' and communication.status in ('failed','bounced') and communication.occurred_at >= v_from and communication.occurred_at <= v_to), 220),
      ('period_inbound_replies', 'Inbound replies in period',
        (select count(*)::numeric from public.relationship_replies reply join public.relationship_communications communication on communication.tenant_id = reply.tenant_id and communication.id = reply.communication_id where reply.tenant_id = v_tenant_id and communication.occurred_at >= v_from and communication.occurred_at <= v_to), 230),
      ('period_campaign_enrollments', 'Campaign enrollments in period',
        (select count(*)::numeric from public.relationship_campaign_enrollments enrollment where enrollment.tenant_id = v_tenant_id and enrollment.created_at >= v_from and enrollment.created_at <= v_to), 240),
      ('period_unique_contacts_reached', 'Unique contacts reached in period',
        (select count(distinct communication.contact_id)::numeric from public.relationship_communications communication where communication.tenant_id = v_tenant_id and communication.direction = 'outbound' and communication.contact_id is not null and communication.status in ('sent','delivered') and communication.occurred_at >= v_from and communication.occurred_at <= v_to), 250),
      ('period_reply_rate_percent', 'Reply rate in period (%)',
        coalesce((select round(100.0 * reply_count / nullif(reached_count, 0), 2)
          from (select
            (select count(*)::numeric from public.relationship_replies reply join public.relationship_communications inbound on inbound.tenant_id = reply.tenant_id and inbound.id = reply.communication_id where reply.tenant_id = v_tenant_id and inbound.occurred_at >= v_from and inbound.occurred_at <= v_to) as reply_count,
            (select count(distinct outbound.contact_id)::numeric from public.relationship_communications outbound where outbound.tenant_id = v_tenant_id and outbound.direction = 'outbound' and outbound.contact_id is not null and outbound.status in ('sent','delivered') and outbound.occurred_at >= v_from and outbound.occurred_at <= v_to) as reached_count
          ) rate), 0)::numeric, 260)
  ), combined as (
    select * from current_metrics
    union all
    select * from period_metrics
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'key', combined.metric_key,
    'label', combined.label,
    'value', combined.metric_value,
    'periodStart', v_from,
    'periodEnd', v_to
  ) order by combined.sort_order), '[]'::jsonb)
  into v_result
  from combined;

  return v_result;
end;
$function$;

revoke all on function public.search_relationships(text, text[], integer, integer) from public;
revoke all on function public.search_relationships(text, text[], integer, integer) from anon;
grant execute on function public.search_relationships(text, text[], integer, integer) to authenticated;

revoke all on function public.get_relationship_report_metrics(jsonb) from public;
revoke all on function public.get_relationship_report_metrics(jsonb) from anon;
grant execute on function public.get_relationship_report_metrics(jsonb) to authenticated;
