set local search_path = '';

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
      tenant_id, first_name, last_name, email,
      phone, veteran_affiliation, outreach_status, relationship_stage,
      review_state, source, source_record_key, metadata
    )
    values (
      p_tenant_id,
      coalesce(v_first, nullif(split_part(coalesce(v_full, ''), ' ', 1), '')),
      coalesce(v_last, nullif(regexp_replace(coalesce(v_full, ''), '^\S+\s*', ''), '')),
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

  insert into public.relationship_contact_organizations as target (
    tenant_id, contact_id, organization_id, role_title, is_primary, metadata
  )
  values (p_tenant_id, v_contact_id, p_organization_id, v_title, true, v_metadata)
  on conflict (contact_id, organization_id) do update
    set role_title = coalesce(excluded.role_title, target.role_title),
        is_primary = true,
        metadata = target.metadata || excluded.metadata,
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

revoke all on function public.bty_apply_contact_enrichment(uuid,uuid,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.bty_apply_contact_enrichment(uuid,uuid,uuid,text,jsonb) to service_role;
