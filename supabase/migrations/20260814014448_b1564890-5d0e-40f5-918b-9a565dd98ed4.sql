set local search_path = '';

-- 1. Internal worker credential for the scheduled automation --------------
create table if not exists private.bty_automation_runtime (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  worker_token text not null default replace(gen_random_uuid()::text, '-', ''),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into private.bty_automation_runtime (tenant_id)
select t.id from public.tenants t
on conflict (tenant_id) do nothing;

create or replace function public.bty_worker_token_valid(p_tenant_id uuid, p_token text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.bty_automation_runtime r
    where r.tenant_id = p_tenant_id
      and r.enabled
      and nullif(p_token, '') is not null
      and r.worker_token = p_token
  );
$$;

revoke all on function public.bty_worker_token_valid(uuid,text) from public, anon, authenticated;
grant execute on function public.bty_worker_token_valid(uuid,text) to service_role;

-- 2. Contact enrichment ---------------------------------------------------
create or replace function public.bty_contact_enrichment_targets(
  p_tenant_id uuid,
  p_business_date date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run private.bty_discovery_runs;
  v_org uuid;
begin
  select * into v_run
    from private.bty_discovery_runs
   where tenant_id = p_tenant_id
     and business_date = p_business_date
     and status = 'success';

  if v_run.id is null then
    return jsonb_build_object('eligible', false, 'reason', 'no_successful_discovery_run');
  end if;

  foreach v_org in array v_run.organization_ids loop
    insert into private.bty_contact_enrichment_runs (
      discovery_run_id, tenant_id, organization_id, status
    )
    values (v_run.id, v_run.tenant_id, v_org, 'pending')
    on conflict (discovery_run_id, organization_id) do nothing;
  end loop;

  return jsonb_build_object(
    'eligible', true,
    'runId', v_run.id,
    'targetState', v_run.target_state,
    'organizations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'organizationId', o.id,
        'name', o.name,
        'website', o.website,
        'headquartersState', o.headquarters_state,
        'directServices', o.metadata->>'direct_services_summary',
        'status', e.status
      ) order by o.name)
      from private.bty_contact_enrichment_runs e
      join public.relationship_organizations o on o.id = e.organization_id
      where e.discovery_run_id = v_run.id
        and e.status in ('pending','running','failed')
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.bty_apply_contact_enrichment(
  p_tenant_id uuid,
  p_run_id uuid,
  p_organization_id uuid,
  p_model text,
  p_contact jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(nullif(trim(p_contact->>'email'), ''));
  v_linkedin text := lower(nullif(trim(p_contact->>'linkedin_url'), ''));
  v_first text := nullif(trim(p_contact->>'first_name'), '');
  v_last text := nullif(trim(p_contact->>'last_name'), '');
  v_full text := nullif(trim(p_contact->>'full_name'), '');
  v_title text := nullif(trim(p_contact->>'title'), '');
  v_contact_id uuid;
  v_reused boolean := false;
  v_metadata jsonb;
begin
  if not exists (
    select 1 from private.bty_discovery_runs r
    where r.id = p_run_id and r.tenant_id = p_tenant_id and r.status = 'success'
      and p_organization_id = any (r.organization_ids)
  ) then
    raise exception 'Organization % is not part of successful BTY discovery run %', p_organization_id, p_run_id;
  end if;

  v_metadata := jsonb_strip_nulls(jsonb_build_object(
    'initiative', 'Beyond The Yellow',
    'discovery_run_id', p_run_id,
    'model', p_model,
    'research_timestamp', now(),
    'why_this_person', p_contact->>'why_this_person',
    'evidence_urls', p_contact->'evidence_urls',
    'research_confidence', p_contact->'confidence',
    'phone', p_contact->>'phone',
    'other_contact_method', p_contact->>'other_contact_method'
  ));

  if v_email is not null then
    select c.id into v_contact_id from public.relationship_contacts c
     where c.tenant_id = p_tenant_id and lower(c.email) = v_email limit 1;
  end if;

  if v_contact_id is null and v_linkedin is not null then
    select s.contact_id into v_contact_id from public.relationship_social_profiles s
     where s.tenant_id = p_tenant_id and s.contact_id is not null
       and s.platform_name = 'linkedin'
       and lower(regexp_replace(s.profile_url, '/+$', '')) = regexp_replace(v_linkedin, '/+$', '')
     limit 1;
  end if;

  if v_contact_id is null and v_first is not null and v_last is not null then
    select c.id into v_contact_id
      from public.relationship_contacts c
      join public.relationship_contact_organizations a
        on a.contact_id = c.id and a.organization_id = p_organization_id
     where c.tenant_id = p_tenant_id
       and lower(coalesce(c.first_name, '')) = lower(v_first)
       and lower(coalesce(c.last_name, '')) = lower(v_last)
     limit 1;
  end if;

  if v_contact_id is not null then
    v_reused := true;
    update public.relationship_contacts
       set email = coalesce(email, v_email),
           first_name = coalesce(first_name, v_first),
           last_name = coalesce(last_name, v_last),
           metadata = metadata || jsonb_build_object('bty_contact_research', v_metadata),
           updated_at = now()
     where id = v_contact_id;
  else
    if v_email is null and v_first is null and v_last is null and v_full is null then
      raise exception 'A verifiable contact identity is required.';
    end if;
    insert into public.relationship_contacts (
      tenant_id, first_name, last_name, preferred_name, email,
      phone, veteran_affiliation, outreach_status, relationship_stage,
      review_state, source, source_record_key, metadata
    )
    values (
      p_tenant_id,
      coalesce(v_first, split_part(coalesce(v_full, ''), ' ', 1)),
      coalesce(v_last, nullif(regexp_replace(coalesce(v_full, ''), '^\S+\s*', ''), '')),
      null,
      v_email,
      nullif(trim(p_contact->>'phone'), ''),
      'unknown',
      'new',
      'identified',
      'direct_outreach',
      'bty_automated_research',
      'bty_contact:' || p_run_id::text || ':' || p_organization_id::text,
      v_metadata
    )
    returning id into v_contact_id;
  end if;

  insert into public.relationship_contact_roles (tenant_id, contact_id, role_code, source, metadata)
  values (p_tenant_id, v_contact_id, 'organization_contact', 'bty_automated_research', v_metadata)
  on conflict do nothing;

  insert into public.relationship_contact_organizations (
    tenant_id, contact_id, organization_id, role_title, is_primary, metadata
  )
  values (p_tenant_id, v_contact_id, p_organization_id, v_title, true, v_metadata)
  on conflict (contact_id, organization_id) do update
    set role_title = coalesce(excluded.role_title, public.relationship_contact_organizations.role_title),
        is_primary = true,
        metadata = public.relationship_contact_organizations.metadata || excluded.metadata,
        updated_at = now();

  if v_linkedin is not null then
    insert into public.relationship_social_profiles (
      tenant_id, contact_id, platform_name, profile_url, approved, source, source_record_key, metadata
    )
    values (
      p_tenant_id, v_contact_id, 'linkedin', trim(p_contact->>'linkedin_url'), true,
      'bty_automated_research',
      'bty_contact_linkedin:' || v_contact_id::text,
      v_metadata
    )
    on conflict do nothing;
  end if;

  update public.relationship_organizations
     set metadata = metadata || jsonb_build_object('contact_research_status', 'complete'),
         updated_at = now()
   where id = p_organization_id and tenant_id = p_tenant_id;

  update private.bty_contact_enrichment_runs
     set status = 'success',
         contact_id = v_contact_id,
         model = p_model,
         confidence = nullif(p_contact->>'confidence', '')::numeric,
         error_summary = '{}'::jsonb,
         metadata = v_metadata,
         completed_at = now(),
         updated_at = now()
   where discovery_run_id = p_run_id and organization_id = p_organization_id;

  return jsonb_build_object('contactId', v_contact_id, 'reused', v_reused);
end;
$$;

create or replace function public.bty_record_contact_enrichment(
  p_run_id uuid,
  p_organization_id uuid,
  p_status text,
  p_model text,
  p_error jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.bty_contact_enrichment_runs
     set status = p_status,
         model = coalesce(p_model, model),
         error_summary = coalesce(p_error, '{}'::jsonb),
         completed_at = case when p_status in ('success','no_verified_contact','failed') then now() else null end,
         updated_at = now()
   where discovery_run_id = p_run_id and organization_id = p_organization_id;

  if p_status = 'no_verified_contact' then
    update public.relationship_organizations
       set metadata = metadata || jsonb_build_object('contact_research_status', 'no_verified_contact'),
           updated_at = now()
     where id = p_organization_id;
  end if;
end;
$$;

revoke all on function public.bty_contact_enrichment_targets(uuid,date) from public, anon, authenticated;
revoke all on function public.bty_apply_contact_enrichment(uuid,uuid,uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.bty_record_contact_enrichment(uuid,uuid,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.bty_contact_enrichment_targets(uuid,date) to service_role;
grant execute on function public.bty_apply_contact_enrichment(uuid,uuid,uuid,text,jsonb) to service_role;
grant execute on function public.bty_record_contact_enrichment(uuid,uuid,text,text,jsonb) to service_role;

-- 3. Deterministic duplicate reconciliation -------------------------------
create or replace function public.bty_preview_organization_duplicates()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_context jsonb := private.relationship_orchestration_context(false);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
begin
  return jsonb_build_object(
    'deterministic', coaleske_placeholder()
  );
end;
$$;

drop function if exists public.bty_preview_organization_duplicates();

create or replace function public.bty_preview_organization_duplicates()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_context jsonb := private.relationship_orchestration_context(false);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
  v_groups jsonb;
  v_ambiguous jsonb;
begin
  with keyed as (
    select o.id, o.name, o.website, o.headquarters_state, o.created_at,
           public.bty_normalize_domain(o.website) as domain,
           public.bty_normalize_org_name(o.name) as norm_name,
           (
             select public.bty_normalize_youtube_url(s.profile_url)
             from public.relationship_social_profiles s
             where s.organization_id = o.id and s.platform_name = 'youtube'
             limit 1
           ) as youtube,
           coalesce((
             select jsonb_agg(r.role_code order by r.role_code)
             from public.relationship_organization_roles r where r.organization_id = o.id
           ), '[]'::jsonb) as roles
    from public.relationship_organizations o
    where o.tenant_id = v_tenant
  ),
  matches as (
    select 'website_domain' as match_type, domain as match_key, id, name, website, headquarters_state, roles, created_at
      from keyed where domain is not null
    union all
    select 'youtube_channel', youtube, id, name, website, headquarters_state, roles, created_at
      from keyed where youtube is not null
    union all
    select 'name_and_state', norm_name || '|' || headquarters_state, id, name, website, headquarters_state, roles, created_at
      from keyed where norm_name is not null and headquarters_state is not null
    union all
    select 'exact_name', norm_name, id, name, website, headquarters_state, roles, created_at
      from keyed where norm_name is not null
  ),
  grouped as (
    select match_type, match_key, count(*) as member_count,
           jsonb_agg(jsonb_build_object(
             'organizationId', id, 'name', name, 'website', website,
             'headquartersState', headquarters_state, 'roles', roles, 'createdAt', created_at
           ) order by created_at) as members
    from matches
    group by match_type, match_key
    having count(*) > 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'matchType', match_type,
           'matchKey', match_key,
           'memberCount', member_count,
           'survivorId', members->0->>'organizationId',
           'duplicateIds', (
             select jsonb_agg(m->>'organizationId')
             from jsonb_array_elements(members) with ordinality t(m, ord)
             where ord > 1
           ),
           'members', members
         ) order by match_type, match_key), '[]'::jsonb)
    into v_groups
  from grouped;

  with keyed as (
    select o.id, o.name, o.headquarters_state,
           public.bty_normalize_org_name(o.name) as norm_name,
           public.bty_normalize_domain(o.website) as domain
    from public.relationship_organizations o
    where o.tenant_id = v_tenant
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'organizationId', a.id, 'name', a.name,
           'similarTo', jsonb_build_object('organizationId', b.id, 'name', b.name),
           'note', 'Fuzzy name similarity only - manual review required, never auto-merged'
         )), '[]'::jsonb)
    into v_ambiguous
  from keyed a
  join keyed b
    on b.id > a.id
   and a.norm_name is not null and b.norm_name is not null
   and a.norm_name <> b.norm_name
   and (a.norm_name like b.norm_name || '%' or b.norm_name like a.norm_name || '%')
   and coalesce(a.domain, '') <> coalesce(b.domain, '');

  return jsonb_build_object('deterministic', v_groups, 'ambiguous', v_ambiguous);
end;
$$;

create or replace function public.bty_merge_organization_duplicates(
  p_survivor_id uuid,
  p_duplicate_ids uuid[],
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb := private.relationship_orchestration_context(true);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
  v_actor uuid := nullif(v_context->>'profile_id', '')::uuid;
  v_dup uuid;
  v_survivor public.relationship_organizations;
  v_merged uuid[] := array[]::uuid[];
begin
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'A merge reason is required.';
  end if;

  select * into v_survivor from public.relationship_organizations
   where id = p_survivor_id and tenant_id = v_tenant for update;
  if v_survivor.id is null then
    raise exception 'Survivor organization not found in this tenant.';
  end if;

  foreach v_dup in array coalesce(p_duplicate_ids, array[]::uuid[]) loop
    if v_dup = p_survivor_id then continue; end if;
    if not exists (
      select 1 from public.relationship_organizations
      where id = v_dup and tenant_id = v_tenant
    ) then
      raise exception 'Duplicate organization % not found in this tenant.', v_dup;
    end if;

    -- roles
    insert into public.relationship_organization_roles (tenant_id, organization_id, role_code, source, metadata)
    select tenant_id, p_survivor_id, role_code, source, metadata
      from public.relationship_organization_roles where organization_id = v_dup
    on conflict (organization_id, role_code) do nothing;
    delete from public.relationship_organization_roles where organization_id = v_dup;

    -- contact affiliations
    insert into public.relationship_contact_organizations (
      tenant_id, contact_id, organization_id, role_title, is_primary, metadata
    )
    select tenant_id, contact_id, p_survivor_id, role_title, is_primary, metadata
      from public.relationship_contact_organizations where organization_id = v_dup
    on conflict (contact_id, organization_id) do nothing;
    delete from public.relationship_contact_organizations where organization_id = v_dup;

    -- social profiles
    update public.relationship_social_profiles set organization_id = p_survivor_id, updated_at = now()
     where organization_id = v_dup;

    -- history, outreach, and workflow references
    update public.relationship_activity_events set organization_id = p_survivor_id where organization_id = v_dup;
    update public.relationship_campaign_enrollments set organization_id = p_survivor_id where organization_id = v_dup;
    update public.relationship_communications set organization_id = p_survivor_id where organization_id = v_dup;
    update public.relationship_import_rows set committed_organization_id = p_survivor_id where committed_organization_id = v_dup;
    update public.relationship_interactions set organization_id = p_survivor_id where organization_id = v_dup;
    update public.relationship_meetings set organization_id = p_survivor_id where organization_id = v_dup;
    update public.relationship_opportunities set organization_id = p_survivor_id where organization_id = v_dup;
    update public.relationship_referrals set organization_id = p_survivor_id where organization_id = v_dup;
    update public.relationship_replies set organization_id = p_survivor_id where organization_id = v_dup;
    update public.relationship_stage_history set organization_id = p_survivor_id where organization_id = v_dup;
    update public.website_submissions set organization_id = p_survivor_id where organization_id = v_dup;
    update public.website_submissions set subject_organization_id = p_survivor_id where subject_organization_id = v_dup;
    update private.bty_contact_enrichment_runs set organization_id = p_survivor_id where organization_id = v_dup;

    delete from public.relationship_suppressions
     where organization_id = v_dup
       and exists (
         select 1 from public.relationship_suppressions s2
         where s2.organization_id = p_survivor_id and s2.tenant_id = v_tenant
       );
    update public.relationship_suppressions set organization_id = p_survivor_id where organization_id = v_dup;

    -- consolidate the survivor record from the duplicate before removal
    update public.relationship_organizations s
       set website = coalesce(s.website, d.website),
           organization_kind = coalesce(s.organization_kind, d.organization_kind),
           headquarters_state = coalesce(s.headquarters_state, d.headquarters_state),
           veteran_affiliated = coalesce(s.veteran_affiliated, d.veteran_affiliated),
           owner_profile_id = coalesce(s.owner_profile_id, d.owner_profile_id),
           next_action = coalesce(s.next_action, d.next_action),
           next_action_due_at = coalesce(s.next_action_due_at, d.next_action_due_at),
           last_contact_at = greatest(coalesce(s.last_contact_at, d.last_contact_at), coalesce(d.last_contact_at, s.last_contact_at)),
           do_not_contact = s.do_not_contact or d.do_not_contact,
           metadata = d.metadata || s.metadata || jsonb_build_object(
             'merged_organizations',
             coalesce(s.metadata->'merged_organizations', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
               'organizationId', d.id,
               'name', d.name,
               'source', d.source,
               'sourceRecordKey', d.source_record_key,
               'metadata', d.metadata,
               'mergedAt', now(),
               'mergedBy', v_actor,
               'reason', p_reason
             ))
           ),
           updated_at = now()
      from public.relationship_organizations d
     where s.id = p_survivor_id and d.id = v_dup;

    delete from public.relationship_organizations where id = v_dup;
    v_merged := v_merged || v_dup;
  end loop;

  return jsonb_build_object('survivorId', p_survivor_id, 'mergedIds', to_jsonb(v_merged), 'reason', p_reason);
end;
$$;

revoke all on function public.bty_preview_organization_duplicates() from public, anon;
revoke all on function public.bty_merge_organization_duplicates(uuid,uuid[],text) from public, anon;
grant execute on function public.bty_preview_organization_duplicates() to authenticated, service_role;
grant execute on function public.bty_merge_organization_duplicates(uuid,uuid[],text) to authenticated, service_role;

-- 4. DST-safe dispatcher --------------------------------------------------
create or replace function private.run_bty_automation_dispatcher()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_runtime private.bty_automation_runtime;
  v_local timestamptz := now();
  v_hhmm text := to_char(now() at time zone 'America/Chicago', 'HH24:MI');
  v_action text;
  v_attempt int;
  v_request_id bigint;
begin
  v_action := case v_hhmm
    when '06:00' then 'discovery'
    when '06:10' then 'discovery'
    when '06:15' then 'discovery'
    when '06:30' then 'contact_enrichment'
    else null
  end;
  v_attempt := case v_hhmm when '06:00' then 1 when '06:10' then 2 when '06:15' then 3 else null end;

  if v_action is null then
    return jsonb_build_object('dispatched', false, 'localTime', v_hhmm);
  end if;

  for v_runtime in select * from private.bty_automation_runtime where enabled loop
    select net.http_post(
      url := 'https://ahqauomkgflopxgnlndd.supabase.co/functions/v1/bty-automation-dispatcher',
      body := jsonb_strip_nulls(jsonb_build_object(
        'tenantId', v_runtime.tenant_id,
        'action', v_action,
        'attempt', v_attempt,
        'localTime', v_hhmm
      )),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Bty-Worker-Token', v_runtime.worker_token
      ),
      timeout_milliseconds := 10000
    ) into v_request_id;
  end loop;

  return jsonb_build_object('dispatched', true, 'action', v_action, 'attempt', v_attempt, 'localTime', v_hhmm);
end;
$$;

revoke all on function private.run_bty_automation_dispatcher() from public, anon, authenticated;

comment on function private.run_bty_automation_dispatcher()
  is 'Every-five-minute DST-safe dispatcher for BTY discovery (06:00/06:10/06:15 CT) and contact enrichment (06:30 CT).';
