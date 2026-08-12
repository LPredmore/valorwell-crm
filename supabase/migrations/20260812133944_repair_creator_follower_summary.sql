-- Reconcile creator summary fields from the current relationship social-profile
-- model. Unknown follower counts remain null; no legacy schema is consulted.

create or replace function private.crm_refresh_influencer_follower_summary(
  p_tenant_id uuid,
  p_contact_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_platform text;
  v_count bigint;
begin
  if p_tenant_id is null or p_contact_id is null then
    return;
  end if;

  select social.platform_name, social.follower_count
  into v_platform, v_count
  from public.relationship_social_profiles social
  where social.tenant_id = p_tenant_id
    and social.contact_id = p_contact_id
    and social.follower_count is not null
  order by social.follower_count desc, social.platform_name, social.id
  limit 1;

  update public.relationship_influencer_profiles influencer
  set highest_follower_platform = v_platform,
      highest_follower_count = v_count,
      metadata = coalesce(influencer.metadata, '{}'::jsonb) || jsonb_build_object(
        'follower_summary_source', 'relationship_social_profiles',
        'follower_summary_reconciled_at', clock_timestamp()
      ),
      updated_at = clock_timestamp()
  where influencer.tenant_id = p_tenant_id
    and influencer.contact_id = p_contact_id
    and (
      influencer.highest_follower_platform is distinct from v_platform
      or influencer.highest_follower_count is distinct from v_count
    );
end;
$function$;

create or replace function private.crm_sync_influencer_follower_summary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform private.crm_refresh_influencer_follower_summary(old.tenant_id, old.contact_id);
  end if;

  if tg_op in ('INSERT', 'UPDATE')
     and (
       tg_op = 'INSERT'
       or old.tenant_id is distinct from new.tenant_id
       or old.contact_id is distinct from new.contact_id
       or old.platform_name is distinct from new.platform_name
       or old.follower_count is distinct from new.follower_count
     ) then
    perform private.crm_refresh_influencer_follower_summary(new.tenant_id, new.contact_id);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

drop trigger if exists crm_social_profile_follower_summary_insert
  on public.relationship_social_profiles;
create trigger crm_social_profile_follower_summary_insert
after insert on public.relationship_social_profiles
for each row execute function private.crm_sync_influencer_follower_summary();

drop trigger if exists crm_social_profile_follower_summary_update
  on public.relationship_social_profiles;
create trigger crm_social_profile_follower_summary_update
after update of tenant_id, contact_id, platform_name, follower_count
on public.relationship_social_profiles
for each row execute function private.crm_sync_influencer_follower_summary();

drop trigger if exists crm_social_profile_follower_summary_delete
  on public.relationship_social_profiles;
create trigger crm_social_profile_follower_summary_delete
after delete on public.relationship_social_profiles
for each row execute function private.crm_sync_influencer_follower_summary();

do $function$
declare
  v_row record;
begin
  for v_row in
    select influencer.tenant_id, influencer.contact_id
    from public.relationship_influencer_profiles influencer
  loop
    perform private.crm_refresh_influencer_follower_summary(
      v_row.tenant_id,
      v_row.contact_id
    );
  end loop;
end;
$function$;

revoke all on function private.crm_refresh_influencer_follower_summary(uuid, uuid),
  private.crm_sync_influencer_follower_summary()
  from public, anon, authenticated;
grant execute on function private.crm_refresh_influencer_follower_summary(uuid, uuid),
  private.crm_sync_influencer_follower_summary()
  to service_role;
