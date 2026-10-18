-- Post-migration catalog assertion; title-change semantics require
-- a separate isolated synthetic video clip update/rollback test.
do $test$
begin
  if not exists (
    select 1 from pg_proc p
    where p.pronamespace='private'::regnamespace
      and p.proname='invalidate_ai_operations_video_downstream_on_title_change'
      and p.proconfig @> array['search_path=']::text[]
  ) then
    raise exception 'AI title override trigger search_path is not fixed';
  end if;
end $test$;
