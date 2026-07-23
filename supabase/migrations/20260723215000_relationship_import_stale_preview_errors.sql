-- Relationship import stale-preview conditions are application conflicts, not
-- serialization failures. SQLSTATE 40001 caused PostgREST/PostgreSQL to retry
-- the full transactional commit until the request timed out with HTTP 504.
-- Convert every stale-preview guard in the existing commit function to a
-- non-retryable PL/pgSQL application error with stable diagnostics.

do $migration$
declare
  v_signature regprocedure := 'private.commit_relationship_import(uuid,bigint,text)'::regprocedure;
  v_definition text;
  v_updated_definition text;
  v_stale_error_count integer;
begin
  select pg_get_functiondef(v_signature)
    into v_definition;

  v_stale_error_count := (
    length(v_definition)
    - length(replace(v_definition, 'errcode = ''40001''', ''))
  ) / length('errcode = ''40001''');

  if v_stale_error_count < 1 then
    raise exception 'Expected stale-preview guards were not found in private.commit_relationship_import.';
  end if;

  v_updated_definition := replace(
    v_definition,
    'errcode = ''40001''',
    'errcode = ''P0001'', detail = ''RELATIONSHIP_IMPORT_STALE_PREVIEW'', hint = ''Create a refreshed server preview from the current CSV, then review and resolve any newly detected matches before committing again.'''
  );

  execute v_updated_definition;

  if position('errcode = ''40001''' in pg_get_functiondef(v_signature)) > 0 then
    raise exception 'One or more retryable stale-preview guards remain in private.commit_relationship_import.';
  end if;
end;
$migration$;

comment on function private.commit_relationship_import(uuid, bigint, text) is
  'Transactional relationship import commit. Stale preview conditions use non-retryable P0001 errors with RELATIONSHIP_IMPORT_STALE_PREVIEW diagnostics.';

comment on function public.commit_relationship_import(uuid, bigint, text) is
  'Idempotent, version-checked, transactional commit of resolved non-clinical relationship import rows. Stale previews return immediate application errors instead of retrying to timeout.';
