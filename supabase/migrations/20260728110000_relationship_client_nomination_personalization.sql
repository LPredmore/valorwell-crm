create or replace function private.set_relationship_client_nomination_sentence()
returns trigger
language plpgsql
set search_path to ''
as $$
declare
  v_referral_id uuid;
  v_referral public.relationship_referrals%rowtype;
  v_organization_name text;
  v_sentence text;
begin
  new.personalization_context := coalesce(new.personalization_context, '{}'::jsonb) - 'approvedSourceSentence';

  if new.source_language_mode <> all (array['verified_anonymous','verified_named']::text[]) then
    return new;
  end if;

  begin
    v_referral_id := nullif(new.personalization_context ->> 'verifiedReferralId', '')::uuid;
  exception when invalid_text_representation then
    return new;
  end;

  if v_referral_id is null then
    return new;
  end if;

  select referral.*
  into v_referral
  from public.relationship_referrals referral
  where referral.tenant_id = new.tenant_id
    and referral.id = v_referral_id
    and referral.verified
    and referral.revoked_at is null
    and lower(regexp_replace(btrim(referral.source_category), '[^a-z0-9]+', '_', 'g')) = 'client_nomination'
    and (
      (referral.contact_id is not null and referral.contact_id = new.contact_id)
      or (referral.organization_id is not null and referral.organization_id = new.organization_id)
    );

  if not found then
    return new;
  end if;

  if new.organization_id is not null then
    select organization.name
    into v_organization_name
    from public.relationship_organizations organization
    where organization.tenant_id = new.tenant_id
      and organization.id = new.organization_id;
  end if;

  v_sentence := case
    when nullif(btrim(v_organization_name), '') is not null
      then 'One of our clients nominated ' || v_organization_name || ' because of the work you are doing in your community.'
    else 'One of our clients nominated you because of the work you are doing in your community.'
  end;

  new.personalization_context := new.personalization_context || jsonb_build_object(
    'approvedSourceSentence',
    v_sentence
  );

  return new;
end;
$$;

revoke all on function private.set_relationship_client_nomination_sentence() from public;

drop trigger if exists a_relationship_client_nomination_sentence on public.relationship_campaign_enrollments;
create trigger a_relationship_client_nomination_sentence
before insert or update of personalization_context, source_language_mode, contact_id, organization_id
on public.relationship_campaign_enrollments
for each row execute function private.set_relationship_client_nomination_sentence();
