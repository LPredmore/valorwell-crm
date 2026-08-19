-- Treat nomination-style BTY outreach as a durable, one-time outreach class.
update public.relationship_campaigns
set metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
  'btyNominationOutreach', true,
  'btyNominationSeriesKey', 'bty_nomination_outreach'
), updated_at = now()
where id in (
  '50ec97e9-340d-4c1e-b2fd-2a3fc7fb649a'::uuid,
  '292d66f7-041b-4faf-873e-20631db4c120'::uuid
);

-- Backfill durable person-level markers from actual sent/delivered history.
with sent as (
  select c.contact_id,
         min(c.sent_at) as first_sent_at,
         max(c.sent_at) as last_sent_at
  from public.relationship_communications c
  join public.relationship_campaigns camp
    on camp.tenant_id=c.tenant_id and camp.id=c.campaign_id
  where c.direction='outbound'
    and c.status in ('sent','delivered')
    and c.sent_at is not null
    and coalesce((camp.metadata->>'btyNominationOutreach')::boolean,false)
    and c.contact_id is not null
  group by c.contact_id
)
update public.relationship_contacts rc
set metadata = coalesce(rc.metadata,'{}'::jsonb) || jsonb_build_object(
      'btyNominationOutreachSent', true,
      'btyNominationOutreachFirstSentAt', to_jsonb(sent.first_sent_at),
      'btyNominationOutreachLastSentAt', to_jsonb(sent.last_sent_at)
    ),
    updated_at = now()
from sent
where rc.id=sent.contact_id;

-- Backfill durable organization-level markers too, so a different contact at the
-- same organization cannot accidentally receive another nomination opener.
with sent as (
  select c.organization_id,
         min(c.sent_at) as first_sent_at,
         max(c.sent_at) as last_sent_at
  from public.relationship_communications c
  join public.relationship_campaigns camp
    on camp.tenant_id=c.tenant_id and camp.id=c.campaign_id
  where c.direction='outbound'
    and c.status in ('sent','delivered')
    and c.sent_at is not null
    and coalesce((camp.metadata->>'btyNominationOutreach')::boolean,false)
    and c.organization_id is not null
  group by c.organization_id
)
update public.relationship_organizations ro
set metadata = coalesce(ro.metadata,'{}'::jsonb) || jsonb_build_object(
      'btyNominationOutreachSent', true,
      'btyNominationOutreachFirstSentAt', to_jsonb(sent.first_sent_at),
      'btyNominationOutreachLastSentAt', to_jsonb(sent.last_sent_at)
    ),
    updated_at = now()
from sent
where ro.id=sent.organization_id;

create or replace function private.guard_bty_nomination_repeat_enrollment()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_is_nomination boolean := false;
  v_already_sent boolean := false;
begin
  select coalesce((c.metadata->>'btyNominationOutreach')::boolean,false)
    into v_is_nomination
  from public.relationship_campaigns c
  where c.tenant_id=new.tenant_id and c.id=new.campaign_id;

  if not coalesce(v_is_nomination,false) then
    return new;
  end if;

  if new.contact_id is not null then
    select coalesce((rc.metadata->>'btyNominationOutreachSent')::boolean,false)
      into v_already_sent
    from public.relationship_contacts rc
    where rc.tenant_id=new.tenant_id and rc.id=new.contact_id;
  end if;

  if not coalesce(v_already_sent,false) and new.organization_id is not null then
    select coalesce((ro.metadata->>'btyNominationOutreachSent')::boolean,false)
      into v_already_sent
    from public.relationship_organizations ro
    where ro.tenant_id=new.tenant_id and ro.id=new.organization_id;
  end if;

  -- Communication history remains the canonical fallback even if a marker was
  -- manually removed or predates this migration.
  if not coalesce(v_already_sent,false) then
    select exists(
      select 1
      from public.relationship_communications comm
      join public.relationship_campaigns prior
        on prior.tenant_id=comm.tenant_id and prior.id=comm.campaign_id
      where comm.tenant_id=new.tenant_id
        and comm.direction='outbound'
        and comm.status in ('sent','delivered')
        and comm.sent_at is not null
        and coalesce((prior.metadata->>'btyNominationOutreach')::boolean,false)
        and (
          (new.contact_id is not null and comm.contact_id=new.contact_id)
          or (new.organization_id is not null and comm.organization_id=new.organization_id)
        )
    ) into v_already_sent;
  end if;

  if coalesce(v_already_sent,false) then
    raise exception 'BTY nomination outreach has already been sent to this contact or organization.' using errcode='42501';
  end if;

  return new;
end;
$function$;

drop trigger if exists a_bty_nomination_repeat_enrollment_guard on public.relationship_campaign_enrollments;
create trigger a_bty_nomination_repeat_enrollment_guard
before insert or update of campaign_id, contact_id, organization_id
on public.relationship_campaign_enrollments
for each row execute function private.guard_bty_nomination_repeat_enrollment();

-- Keep the marker current automatically after any future nomination-style send.
create or replace function private.mark_bty_nomination_outreach_sent()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_is_nomination boolean := false;
  v_sent_at timestamptz;
begin
  if new.direction is distinct from 'outbound'
     or new.status not in ('sent','delivered')
     or new.sent_at is null then
    return new;
  end if;

  select coalesce((c.metadata->>'btyNominationOutreach')::boolean,false)
    into v_is_nomination
  from public.relationship_campaigns c
  where c.tenant_id=new.tenant_id and c.id=new.campaign_id;

  if not coalesce(v_is_nomination,false) then
    return new;
  end if;

  v_sent_at := new.sent_at;

  if new.contact_id is not null then
    update public.relationship_contacts rc
    set metadata = coalesce(rc.metadata,'{}'::jsonb) || jsonb_build_object(
          'btyNominationOutreachSent', true,
          'btyNominationOutreachFirstSentAt', coalesce(rc.metadata->'btyNominationOutreachFirstSentAt',to_jsonb(v_sent_at)),
          'btyNominationOutreachLastSentAt', to_jsonb(v_sent_at)
        ),
        updated_at = now()
    where rc.tenant_id=new.tenant_id and rc.id=new.contact_id;
  end if;

  if new.organization_id is not null then
    update public.relationship_organizations ro
    set metadata = coalesce(ro.metadata,'{}'::jsonb) || jsonb_build_object(
          'btyNominationOutreachSent', true,
          'btyNominationOutreachFirstSentAt', coalesce(ro.metadata->'btyNominationOutreachFirstSentAt',to_jsonb(v_sent_at)),
          'btyNominationOutreachLastSentAt', to_jsonb(v_sent_at)
        ),
        updated_at = now()
    where ro.tenant_id=new.tenant_id and ro.id=new.organization_id;
  end if;

  return new;
end;
$function$;

drop trigger if exists z_mark_bty_nomination_outreach_sent on public.relationship_communications;
create trigger z_mark_bty_nomination_outreach_sent
after insert or update of status, sent_at
on public.relationship_communications
for each row execute function private.mark_bty_nomination_outreach_sent();