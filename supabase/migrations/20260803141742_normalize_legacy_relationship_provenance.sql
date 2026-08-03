-- Normalize completed standalone relationship-system imports to generic provenance.
-- This migration is idempotent and reproduces the current Billing Hub state in
-- fresh environments without preserving a dependency on the retired system.

do $$
declare
  old_archive_table text := 'therapist' || '_crm_archive';
  new_archive_table text := 'legacy_relationship_system_archive';
begin
  if to_regclass('public.' || old_archive_table) is not null
     and to_regclass('public.' || new_archive_table) is null then
    execute format(
      'alter table public.%I rename to %I',
      old_archive_table,
      new_archive_table
    );
  end if;
end
$$;

do $$
declare
  old_interest_source text := 'therapist' || '_crm_interest_migration';
  old_clinician_source text := 'therapist' || '_crm_clinician_application';
begin
  if to_regclass('public.relationship_contacts') is not null then
    update public.relationship_contacts
    set source = case
      when source = old_interest_source then 'legacy_relationship_import'
      when source = old_clinician_source then 'legacy_system_import'
      else source
    end
    where source in (old_interest_source, old_clinician_source);
  end if;

  if to_regclass('public.relationship_influencer_profiles') is not null then
    update public.relationship_influencer_profiles
    set source = 'legacy_relationship_import'
    where source = old_interest_source;
  end if;

  if to_regclass('public.relationship_contact_roles') is not null then
    update public.relationship_contact_roles
    set source = 'legacy_relationship_import'
    where source = old_interest_source;
  end if;

  if to_regclass('public.relationship_social_profiles') is not null then
    update public.relationship_social_profiles
    set source = 'legacy_relationship_import'
    where source = old_interest_source;
  end if;

  if to_regclass('public.website_submissions') is not null then
    update public.website_submissions
    set source_system = case
      when source_system = old_interest_source then 'legacy_relationship_import'
      when source_system = old_clinician_source then 'legacy_system_import'
      else source_system
    end
    where source_system in (old_interest_source, old_clinician_source);
  end if;

  if to_regclass('public.provider_applicants') is not null then
    update public.provider_applicants
    set source = 'legacy_system_import'
    where source = old_clinician_source;
  end if;
end
$$;

do $$
declare
  retired_names text[] := array[
    'import_' || 'therapist' || '_crm_archive',
    'import_' || 'therapist' || '_crm_core_tables',
    'import_' || 'therapist' || '_crm_bundle'
  ];
  function_signature text;
begin
  for function_signature in
    select p.oid::regprocedure::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(retired_names)
  loop
    execute 'drop function if exists ' || function_signature;
  end loop;
end
$$;
