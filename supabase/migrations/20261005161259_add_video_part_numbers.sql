alter table public.ai_operations_video_clips
  add column if not exists part_number integer;

with ranked as (
  select
    id,
    row_number() over (
      partition by project_id
      order by start_seconds asc, id asc
    )::integer as part_number
  from public.ai_operations_video_clips
  where clip_type = 'part'
)
update public.ai_operations_video_clips c
set part_number = r.part_number
from ranked r
where c.id = r.id
  and c.part_number is distinct from r.part_number;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ai_operations_video_clips_part_number_check'
      and conrelid = 'public.ai_operations_video_clips'::regclass
  ) then
    alter table public.ai_operations_video_clips
      add constraint ai_operations_video_clips_part_number_check
      check (
        part_number is null
        or (clip_type = 'part' and part_number > 0)
      );
  end if;
end
$$;

create unique index if not exists ai_operations_video_clips_project_part_number_uidx
  on public.ai_operations_video_clips (project_id, part_number)
  where clip_type = 'part' and part_number is not null;

create or replace function private.assign_ai_operations_video_part_number()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.clip_type <> 'part' then
    new.part_number := null;
    return new;
  end if;

  if new.part_number is null then
    perform pg_advisory_xact_lock(hashtextextended(new.project_id::text, 0));

    select coalesce(max(c.part_number), 0) + 1
      into new.part_number
    from public.ai_operations_video_clips c
    where c.project_id = new.project_id
      and c.clip_type = 'part'
      and (tg_op = 'INSERT' or c.id <> new.id);
  end if;

  return new;
end;
$$;

drop trigger if exists assign_ai_operations_video_part_number
  on public.ai_operations_video_clips;

create trigger assign_ai_operations_video_part_number
before insert or update of clip_type, project_id, part_number
on public.ai_operations_video_clips
for each row
execute function private.assign_ai_operations_video_part_number();
