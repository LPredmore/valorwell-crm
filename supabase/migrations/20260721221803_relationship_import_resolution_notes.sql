create or replace function private.resolve_relationship_import_conflicts_with_notes(
  p_import_id uuid,
  p_resolutions jsonb,
  p_expected_version bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb := private.relationship_import_context(true);
  v_tenant_id uuid := (v_context ->> 'tenant_id')::uuid;
  v_resolution jsonb;
  v_row_number integer;
  v_note text;
begin
  perform private.resolve_relationship_import_conflicts(
    p_import_id,
    p_resolutions,
    p_expected_version
  );

  for v_resolution in
    select value from jsonb_array_elements(p_resolutions)
  loop
    v_row_number := coalesce(
      nullif(v_resolution ->> 'row', '')::integer,
      nullif(v_resolution ->> 'row_number', '')::integer
    );
    v_note := nullif(btrim(v_resolution ->> 'note'), '');

    if v_row_number is not null and v_note is not null then
      update public.relationship_import_rows import_row
      set resolution = import_row.resolution || jsonb_build_object('note', v_note)
      where import_row.tenant_id = v_tenant_id
        and import_row.import_id = p_import_id
        and import_row.row_number = v_row_number;
    end if;
  end loop;

  return private.get_relationship_import_preview(p_import_id);
end;
$$;

create or replace function public.resolve_relationship_import_conflicts(
  p_import_id uuid,
  p_resolutions jsonb,
  p_expected_version bigint default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.resolve_relationship_import_conflicts_with_notes(
    p_import_id,
    p_resolutions,
    p_expected_version
  );
$$;

revoke all on function private.resolve_relationship_import_conflicts_with_notes(uuid, jsonb, bigint) from public, anon;
grant execute on function private.resolve_relationship_import_conflicts_with_notes(uuid, jsonb, bigint) to authenticated, service_role;

revoke all on function public.resolve_relationship_import_conflicts(uuid, jsonb, bigint) from public, anon;
grant execute on function public.resolve_relationship_import_conflicts(uuid, jsonb, bigint) to authenticated, service_role;

comment on function private.resolve_relationship_import_conflicts_with_notes(uuid, jsonb, bigint) is
  'Applies version-checked import conflict decisions and persists optional internal resolution notes.';
