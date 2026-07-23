alter table public.crm_domain_contracts
  add column if not exists contract_version integer not null default 1,
  add column if not exists schema_fingerprint text,
  add column if not exists generated_type_hash text,
  add column if not exists capability_manifest jsonb not null default '{}'::jsonb,
  add column if not exists object_inventory jsonb not null default '{}'::jsonb,
  add column if not exists rpc_signatures jsonb not null default '[]'::jsonb,
  add column if not exists grant_manifest jsonb not null default '{}'::jsonb,
  add column if not exists release_status text not null default 'not_evaluated',
  add column if not exists activation_status text not null default 'locked',
  add column if not exists activation_blockers jsonb not null default '[]'::jsonb,
  add column if not exists acceptance_evidence jsonb not null default '{}'::jsonb,
  add column if not exists accepted_at timestamptz;

alter table public.crm_domain_contracts drop constraint if exists crm_domain_contracts_status_check;
alter table public.crm_domain_contracts add constraint crm_domain_contracts_status_check
  check (implementation_status in ('phase_1_established','production_hardening_in_progress','production_hardened','active','superseded'));
alter table public.crm_domain_contracts drop constraint if exists crm_domain_contracts_release_status_check;
alter table public.crm_domain_contracts add constraint crm_domain_contracts_release_status_check
  check (release_status in ('not_evaluated','release_candidate','accepted','rejected'));
alter table public.crm_domain_contracts drop constraint if exists crm_domain_contracts_activation_status_check;
alter table public.crm_domain_contracts add constraint crm_domain_contracts_activation_status_check
  check (activation_status in ('locked','pilot_ready','active','suspended'));

with object_manifest as (
  select jsonb_build_object(
    'tables', coalesce((
      select jsonb_agg(jsonb_build_object(
        'schema', n.nspname,
        'name', c.relname,
        'rls', c.relrowsecurity,
        'force_rls', c.relforcerowsecurity
      ) order by n.nspname,c.relname)
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','private') and c.relkind='r' and c.relname like 'relationship_%'
    ), '[]'::jsonb),
    'views', coalesce((
      select jsonb_agg(jsonb_build_object(
        'schema', n.nspname,
        'name', c.relname,
        'security_invoker', coalesce(array_to_string(c.reloptions,','),'') like '%security_invoker=true%'
      ) order by n.nspname,c.relname)
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='v' and c.relname like 'relationship_%'
    ), '[]'::jsonb),
    'indexes', coalesce((
      select jsonb_agg(jsonb_build_object('schema',schemaname,'table',tablename,'name',indexname) order by schemaname,tablename,indexname)
      from pg_indexes where schemaname in ('public','private') and tablename like 'relationship_%'
    ), '[]'::jsonb)
  ) as value
), rpc_manifest as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'schema', n.nspname,
    'signature', p.oid::regprocedure::text,
    'security_definer', p.prosecdef,
    'configuration', coalesce(to_jsonb(p.proconfig),'[]'::jsonb),
    'anon_execute', has_function_privilege('anon',p.oid,'execute'),
    'authenticated_execute', has_function_privilege('authenticated',p.oid,'execute'),
    'service_role_execute', has_function_privilege('service_role',p.oid,'execute')
  ) order by n.nspname,p.oid::regprocedure::text), '[]'::jsonb) as value
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.proname like '%relationship%'
), grants as (
  select jsonb_build_object(
    'views_select_only', coalesce((
      select jsonb_agg(jsonb_build_object(
        'view', c.relname,
        'authenticated_select', has_table_privilege('authenticated',c.oid,'select'),
        'authenticated_insert', has_table_privilege('authenticated',c.oid,'insert'),
        'authenticated_update', has_table_privilege('authenticated',c.oid,'update'),
        'authenticated_delete', has_table_privilege('authenticated',c.oid,'delete'),
        'anon_select', has_table_privilege('anon',c.oid,'select')
      ) order by c.relname)
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='v' and c.relname like 'relationship_%'
    ), '[]'::jsonb),
    'anonymous_relationship_rpcs', coalesce((
      select jsonb_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text)
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname like '%relationship%' and has_function_privilege('anon',p.oid,'execute')
    ), '[]'::jsonb),
    'private_schema_data_api_exposed', false
  ) as value
), fingerprint_source as (
  select jsonb_build_object(
    'objects', object_manifest.value,
    'rpcs', rpc_manifest.value,
    'grants', grants.value,
    'policies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'schema',schemaname,'table',tablename,'name',policyname,'roles',roles,
        'command',cmd,'using',qual,'check',with_check
      ) order by schemaname,tablename,policyname)
      from pg_policies
      where schemaname in ('public','private') and tablename like 'relationship_%'
    ), '[]'::jsonb)
  ) as value
  from object_manifest,rpc_manifest,grants
)
update public.crm_domain_contracts c
set contract_version = 1,
    implementation_status = 'production_hardening_in_progress',
    capability_manifest = jsonb_build_object(
      'organizations','available','contacts','available','referrals','available','opportunities','available',
      'interactions','available','imports','available','campaigns','available','enrollment','available',
      'suppression','available','unsubscribe','available','delivery','implemented_locked','replies','available',
      'search','available','reporting','available'
    ),
    object_inventory = object_manifest.value,
    rpc_signatures = rpc_manifest.value,
    grant_manifest = grants.value,
    schema_fingerprint = encode(extensions.digest(fingerprint_source.value::text,'sha256'),'hex'),
    release_status = 'release_candidate',
    activation_status = 'locked',
    activation_blockers = jsonb_build_array(
      'delivery_provider_not_configured',
      'outbound_sender_not_verified',
      'inbound_route_not_verified',
      'provider_webhook_not_verified',
      'delivery_worker_not_verified',
      'pilot_campaign_not_approved'
    ),
    acceptance_evidence = jsonb_build_object(
      'database_migration_head','relationship_release_contract_foundation',
      'activation_decision','no_go_pending_provider_and_pilot_readiness',
      'clinical_boundary_preserved',true,
      'destructive_cleanup_performed',false
    ),
    accepted_at = null,
    effective_at = now(),
    updated_at = now()
from object_manifest,rpc_manifest,grants,fingerprint_source
where c.domain_key='business_development_relationships';

revoke all on public.crm_domain_contracts from anon;
grant select on public.crm_domain_contracts to authenticated, service_role;
