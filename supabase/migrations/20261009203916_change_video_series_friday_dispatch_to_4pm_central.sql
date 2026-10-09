-- BTY Series assignment cutoff and dispatch: Friday 4:00 PM America/Chicago (DST-aware).
CREATE OR REPLACE FUNCTION private.video_series_schedule_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_tenant uuid;
begin
  select p.tenant_id into v_tenant from public.ai_operations_video_projects p where p.id = new.project_id;
  if v_tenant is null or v_tenant <> new.tenant_id then
    raise exception 'Project % does not belong to tenant %', new.project_id, new.tenant_id;
  end if;
  new.timezone := 'America/Chicago';
  -- Friday before the assigned Monday at 16:00 America/Chicago (DST aware).
  new.dispatch_at := ((new.week_start - 3)::timestamp + time '16:00') at time zone 'America/Chicago';
  if tg_op = 'INSERT' then
    if now() >= new.dispatch_at then
      raise exception 'Cutoff passed: series weeks can only be assigned before Friday 4:00 PM Central';
    end if;
  else
    if new.tenant_id <> old.tenant_id then raise exception 'tenant_id is immutable'; end if;
    if (new.project_id <> old.project_id or new.week_start <> old.week_start
        or (new.status = 'cancelled' and old.status <> 'cancelled')) then
      -- Hard cutoff evaluated against the row's original deadline, atomically in the UPDATE.
      if now() >= old.dispatch_at then
        raise exception 'Cutoff passed: this series week can no longer be changed or removed';
      end if;
      if old.dispatch_started_at is not null then
        raise exception 'Series dispatch has already started; the week can no longer be changed or removed';
      end if;
      if old.lease_expires_at is not null and old.lease_expires_at > now() then
        raise exception 'This series week is being processed right now';
      end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $function$
;
