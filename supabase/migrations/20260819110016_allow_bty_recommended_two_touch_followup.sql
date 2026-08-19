create or replace function private.guard_bty_followup_activation()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.is_active
     and new.position > 1
     and exists (
       select 1
       from public.relationship_campaigns c
       where c.tenant_id = new.tenant_id
         and c.id = new.campaign_id
         and c.lifecycle_policy = 'bty_guest_outreach_v1'
     ) then
    -- Approved exception: the Recommended Organization campaign is intentionally
    -- a two-touch sequence. It may have exactly one automated follow-up, only
    -- when reply-stop remains enabled and the follow-up is delayed at least 4 days.
    if new.position = 2
       and new.stop_on_reply is true
       and new.delay_days >= 4
       and exists (
         select 1
         from public.relationship_campaigns c
         where c.tenant_id = new.tenant_id
           and c.id = new.campaign_id
           and c.source_record_key = 'bty_recommended_organization_outreach_v1'
       ) then
      return new;
    end if;

    raise exception 'Automated BTY follow-up steps must remain inactive unless explicitly approved by campaign policy.' using errcode='42501';
  end if;

  return new;
end;
$function$;
