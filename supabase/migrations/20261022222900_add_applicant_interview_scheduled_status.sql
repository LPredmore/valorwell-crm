-- Separate transaction: new enum labels cannot be referenced until committed.
-- Extend the authoritative applicant status enum without assuming its type name.
do $status$
declare v_schema text; v_type text;
begin
  select n.nspname, t.typname into v_schema,v_type
  from pg_attribute a join pg_class c on c.oid=a.attrelid
    join pg_namespace cn on cn.oid=c.relnamespace
    join pg_type t on t.oid=a.atttypid join pg_namespace n on n.oid=t.typnamespace
  where cn.nspname='public' and c.relname='provider_applicants'
    and a.attname='status' and not a.attisdropped;
  if v_type is null then raise exception 'Provider applicant status column not found'; end if;
  if exists(select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace
    where t.typname=v_type and n.nspname=v_schema and t.typtype='e') then
    execute format('ALTER TYPE %I.%I ADD VALUE IF NOT EXISTS %L',v_schema,v_type,'interview_scheduled');
  else
    raise exception 'Expected enum-backed applicant status, got %.%',v_schema,v_type;
  end if;
end $status$;

