create or replace function private.guard_bty_followup_activation()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.is_active and new.position>1 and exists(
    select 1 from public.relationship_campaigns c
    where c.tenant_id=new.tenant_id and c.id=new.campaign_id and c.lifecycle_policy='bty_guest_outreach_v1'
  ) then
    raise exception 'Automated BTY follow-up steps must remain inactive.' using errcode='42501';
  end if;
  return new;
end;
$function$;

create or replace function private.set_bty_recommended_campaign_sentence_and_guard()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_source_record_key text;
  v_organization_name text;
  v_referral_id uuid;
  v_referral public.relationship_referrals%rowtype;
  v_nominee_source text;
  v_sentence text;
begin
  select c.source_record_key
    into v_source_record_key
  from public.relationship_campaigns c
  where c.tenant_id=new.tenant_id and c.id=new.campaign_id;

  if v_source_record_key is distinct from 'bty_recommended_organization_outreach_v1' then
    return new;
  end if;

  if new.organization_id is null then
    raise exception 'Recommended Organization campaign requires an organization target.' using errcode='42501';
  end if;

  select o.name
    into v_organization_name
  from public.relationship_organizations o
  where o.tenant_id=new.tenant_id and o.id=new.organization_id;

  if nullif(btrim(v_organization_name),'') is null then
    raise exception 'Recommended Organization campaign requires a valid organization.' using errcode='42501';
  end if;

  begin
    v_referral_id:=nullif(new.personalization_context->>'verifiedReferralId','')::uuid;
  exception when invalid_text_representation then
    v_referral_id:=null;
  end;

  if v_referral_id is not null then
    select r.* into v_referral
    from public.relationship_referrals r
    where r.tenant_id=new.tenant_id
      and r.id=v_referral_id
      and r.verified
      and r.revoked_at is null
      and lower(regexp_replace(btrim(r.source_category),'[^a-z0-9]+','_','g'))='client_nomination'
      and ((r.organization_id is not null and r.organization_id=new.organization_id)
           or (r.contact_id is not null and r.contact_id=new.contact_id));

    if found then
      v_sentence:='One of our clients recommended '||v_organization_name||' as an organization we should feature on Beyond The Yellow.';
    end if;
  end if;

  if v_sentence is null then
    select role.source
      into v_nominee_source
    from public.relationship_organization_roles role
    where role.tenant_id=new.tenant_id
      and role.organization_id=new.organization_id
      and role.role_code='bty_nominee'
    order by role.updated_at desc nulls last, role.created_at desc
    limit 1;

    if not found and new.contact_id is not null then
      select role.source
        into v_nominee_source
      from public.relationship_contact_roles role
      where role.tenant_id=new.tenant_id
        and role.contact_id=new.contact_id
        and role.role_code='bty_nominee'
      order by role.updated_at desc nulls last, role.created_at desc
      limit 1;
    end if;

    if v_nominee_source is null then
      raise exception 'Recommended Organization campaign requires verified recommendation evidence.' using errcode='42501';
    end if;

    if lower(v_nominee_source) like '%website%' then
      v_sentence:='Someone recently recommended '||v_organization_name||' as an organization we should feature on Beyond The Yellow.';
    else
      v_sentence:=v_organization_name||' was recently recommended to us as an organization we should feature on Beyond The Yellow.';
    end if;
  end if;

  new.personalization_context:=coalesce(new.personalization_context,'{}'::jsonb)
    || jsonb_build_object('approvedSourceSentence',v_sentence);

  return new;
end;
$function$;

drop trigger if exists b_bty_recommended_campaign_sentence_guard on public.relationship_campaign_enrollments;
create trigger b_bty_recommended_campaign_sentence_guard
before insert or update of campaign_id, personalization_context, source_language_mode, contact_id, organization_id
on public.relationship_campaign_enrollments
for each row execute function private.set_bty_recommended_campaign_sentence_and_guard();
