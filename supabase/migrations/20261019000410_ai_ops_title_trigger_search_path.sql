-- Supabase advisor 0011: this SECURITY INVOKER trigger is in private,
-- calls only pg_catalog builtins, and accesses NEW/OLD row values.
-- Pin its search path to remove caller-controlled resolution.
begin;
alter function private.invalidate_ai_operations_video_downstream_on_title_change()
  set search_path = '';
commit;
