create or replace function private.list_relationship_campaign_candidates(
  p_filters jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_context jsonb := private.relationship_enrollment_context(false);
  v_tenant_id uuid := (v_context ->> 'tenant_id')::uuid;
  v_audiences text[];
  v_search text := lower(nullif(btrim(coalesce(p_filters ->> 'search', '')), ''));
  v_page integer := greatest(coalesce(nullif(p_filters ->> 'page', '')::integer, 1), 1);
  v_page_size integer := least(greatest(coalesce(nullif(p_filters ->> 'pageSize', '')::integer, 100), 1), 1000);
  v_offset integer;
begin
  select coalesce(array_agg(distinct lower(value)), array['donor', 'bty_referral']::text[])
  into v_audiences
  from jsonb_array_elements_text(
    case
      when jsonb_typeof(p_filters -> 'audiences') = 'array'
        and jsonb_array_length(p_filters -> 'audiences') > 0
      then p_filters -> 'audiences'
      else '["donor", "bty_referral"]'::jsonb
    end
  );

  if exists (
    select 1 from unnest(v_audiences) audience
    where audience not in ('donor', 'bty_referral')
  ) then
    raise exception 'Unsupported bulk enrollment audience.' using errcode = '22023';
  end if;

  v_offset := (v_page - 1) * v_page_size;

  return (
    with preferred_contacts as (
      select distinct on (link.organization_id)
        link.organization_id,
        contact.id as contact_id,
        coalesce(
          nullif(btrim(concat_ws(' ', coalesce(nullif(contact.preferred_name, ''), contact.first_name), contact.last_name)), ''),
          contact.email
        ) as contact_name,
        lower(btrim(contact.email)) as email,
        contact.do_not_contact,
        link.is_primary
      from public.relationship_contact_organizations link
      join public.relationship_contacts contact
        on contact.tenant_id = link.tenant_id
       and contact.id = link.contact_id
      where link.tenant_id = v_tenant_id
        and nullif(btrim(contact.email), '') is not null
      order by link.organization_id, link.is_primary desc, contact.do_not_contact asc, contact.updated_at desc, contact.id
    ),
    primary_organizations as (
      select distinct on (link.contact_id)
        link.contact_id,
        link.organization_id
      from public.relationship_contact_organizations link
      where link.tenant_id = v_tenant_id
      order by link.contact_id, link.is_primary desc, link.updated_at desc, link.organization_id
    ),
    verified_referrals as (
      select
        referral.id,
        referral.organization_id,
        referral.contact_id,
        referral.source_category,
        referral.disclosure,
        referral.verified_at
      from public.relationship_referrals referral
      where referral.tenant_id = v_tenant_id
        and referral.verified
        and referral.revoked_at is null
        and regexp_replace(lower(btrim(referral.source_category)), '[^a-z0-9]+', '_', 'g')
          in ('client_nomination', 'bty_referral', 'bty_nomination')
    ),
    candidate_rows as (
      select
        preferred.contact_id,
        preferred.contact_name,
        preferred.email,
        preferred.organization_id,
        organization.name as organization_name,
        preferred.do_not_contact,
        organization.do_not_contact as organization_do_not_contact,
        'donor'::text as audience_kind,
        role.role_code,
        null::uuid as referral_id,
        null::text as referral_category,
        null::text as referral_disclosure,
        null::timestamptz as referral_verified_at
      from public.relationship_organization_roles role
      join preferred_contacts preferred on preferred.organization_id = role.organization_id
      join public.relationship_organizations organization
        on organization.tenant_id = role.tenant_id
       and organization.id = role.organization_id
      where role.tenant_id = v_tenant_id
        and role.role_code = 'funder'

      union all

      select
        preferred.contact_id,
        preferred.contact_name,
        preferred.email,
        preferred.organization_id,
        organization.name,
        preferred.do_not_contact,
        organization.do_not_contact,
        'bty_referral'::text,
        role.role_code,
        null::uuid,
        null::text,
        null::text,
        null::timestamptz
      from public.relationship_organization_roles role
      join preferred_contacts preferred on preferred.organization_id = role.organization_id
      join public.relationship_organizations organization
        on organization.tenant_id = role.tenant_id
       and organization.id = role.organization_id
      where role.tenant_id = v_tenant_id
        and role.role_code in ('bty_nominee', 'bty_referral')

      union all

      select
        contact.id,
        coalesce(
          nullif(btrim(concat_ws(' ', coalesce(nullif(contact.preferred_name, ''), contact.first_name), contact.last_name)), ''),
          contact.email
        ),
        lower(btrim(contact.email)),
        primary_org.organization_id,
        organization.name,
        contact.do_not_contact,
        coalesce(organization.do_not_contact, false),
        'bty_referral'::text,
        role.role_code,
        null::uuid,
        null::text,
        null::text,
        null::timestamptz
      from public.relationship_contact_roles role
      join public.relationship_contacts contact
        on contact.tenant_id = role.tenant_id
       and contact.id = role.contact_id
      left join primary_organizations primary_org on primary_org.contact_id = contact.id
      left join public.relationship_organizations organization
        on organization.tenant_id = role.tenant_id
       and organization.id = primary_org.organization_id
      where role.tenant_id = v_tenant_id
        and role.role_code in ('bty_nominee', 'bty_referral')
        and nullif(btrim(contact.email), '') is not null

      union all

      select
        contact.id,
        coalesce(
          nullif(btrim(concat_ws(' ', coalesce(nullif(contact.preferred_name, ''), contact.first_name), contact.last_name)), ''),
          contact.email
        ),
        lower(btrim(contact.email)),
        coalesce(referral.organization_id, primary_org.organization_id),
        organization.name,
        contact.do_not_contact,
        coalesce(organization.do_not_contact, false),
        'bty_referral'::text,
        null::text,
        referral.id,
        referral.source_category,
        referral.disclosure,
        referral.verified_at
      from verified_referrals referral
      join public.relationship_contacts contact
        on contact.tenant_id = v_tenant_id
       and contact.id = referral.contact_id
      left join primary_organizations primary_org on primary_org.contact_id = contact.id
      left join public.relationship_organizations organization
        on organization.tenant_id = v_tenant_id
       and organization.id = coalesce(referral.organization_id, primary_org.organization_id)
      where referral.contact_id is not null
        and nullif(btrim(contact.email), '') is not null

      union all

      select
        preferred.contact_id,
        preferred.contact_name,
        preferred.email,
        preferred.organization_id,
        organization.name,
        preferred.do_not_contact,
        organization.do_not_contact,
        'bty_referral'::text,
        null::text,
        referral.id,
        referral.source_category,
        referral.disclosure,
        referral.verified_at
      from verified_referrals referral
      join preferred_contacts preferred on preferred.organization_id = referral.organization_id
      join public.relationship_organizations organization
        on organization.tenant_id = v_tenant_id
       and organization.id = referral.organization_id
      where referral.contact_id is null
        and referral.organization_id is not null
    ),
    audience_filtered as (
      select *
      from candidate_rows row
      where row.audience_kind = any(v_audiences)
    ),
    summaries as (
      select
        row.contact_id,
        array_agg(distinct row.audience_kind order by row.audience_kind) as audience_kinds,
        array_remove(array_agg(distinct row.role_code order by row.role_code), null) as role_codes
      from audience_filtered row
      group by row.contact_id
    ),
    representatives as (
      select distinct on (row.contact_id)
        row.*
      from audience_filtered row
      order by
        row.contact_id,
        (row.referral_id is not null) desc,
        case row.audience_kind when 'bty_referral' then 0 else 1 end,
        row.referral_verified_at desc nulls last,
        row.organization_name nulls last
    ),
    resolved as (
      select
        representative.contact_id,
        representative.contact_name,
        representative.email,
        representative.organization_id,
        representative.organization_name,
        summary.audience_kinds,
        summary.role_codes,
        case
          when representative.referral_id is not null and representative.referral_disclosure = 'named_referrer' then 'verified_named'
          when representative.referral_id is not null and representative.referral_disclosure = 'community_anonymous' then 'verified_anonymous'
          when representative.referral_id is not null then 'community'
          when 'bty_nominee' = any(summary.role_codes) then 'research'
          when 'bty_referral' = any(summary.role_codes) then 'community'
          when 'bty_referral' = any(summary.audience_kinds) then 'community'
          else 'research'
        end as source_language_mode,
        representative.referral_id,
        representative.referral_category,
        representative.referral_disclosure,
        representative.do_not_contact,
        representative.organization_do_not_contact
      from representatives representative
      join summaries summary on summary.contact_id = representative.contact_id
      where v_search is null
         or lower(concat_ws(' ', representative.contact_name, representative.email, representative.organization_name)) like '%' || v_search || '%'
    ),
    paged as (
      select *
      from resolved
      order by organization_name nulls last, contact_name, email
      offset v_offset
      limit v_page_size
    )
    select jsonb_build_object(
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'contactId', item.contact_id,
          'contactName', item.contact_name,
          'email', item.email,
          'organizationId', item.organization_id,
          'organizationName', item.organization_name,
          'audienceKinds', to_jsonb(item.audience_kinds),
          'roleCodes', to_jsonb(item.role_codes),
          'sourceLanguageMode', item.source_language_mode,
          'verifiedReferralId', item.referral_id,
          'referralCategory', item.referral_category,
          'referralDisclosure', item.referral_disclosure,
          'doNotContact', item.do_not_contact,
          'organizationDoNotContact', item.organization_do_not_contact
        ) order by item.organization_name nulls last, item.contact_name, item.email)
        from paged item
      ), '[]'::jsonb),
      'total', (select count(*) from resolved),
      'page', v_page,
      'pageSize', v_page_size
    )
  );
end;
$function$;
