create index relationship_import_rows_committed_opportunity_idx
  on public.relationship_import_rows (tenant_id, committed_opportunity_id)
  where committed_opportunity_id is not null;

create index relationship_imports_created_by_profile_idx
  on public.relationship_imports (created_by_profile_id)
  where created_by_profile_id is not null;

create index relationship_imports_updated_by_profile_idx
  on public.relationship_imports (updated_by_profile_id)
  where updated_by_profile_id is not null;
