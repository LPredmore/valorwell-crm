-- Synthetic fixture ONLY. Run inside the existing active-connection guarded
-- disposable 5B/5C acceptance cluster. Never apply this file as a migration.
-- The crm_emit_automation_event body below is an exact 2026-10-18 read-only
-- pg_get_functiondef snapshot from production; dependencies are narrow stubs.
-- This tests the actual emitter body/ACL over real signed GoTrue/PostgREST,
-- not the complete CRM campaign engine or worker transport.
create table public.crm_automation_events(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null, event_type text not null,
  person_id uuid, subject_type text, subject_id uuid,
  source text, source_event_id uuid,
  idempotency_key text not null, payload jsonb,
  occurred_at timestamptz not null,
  unique(tenant_id,idempotency_key)
);
create table public.crm_emitter_test_jobs(
  event_id uuid primary key references public.crm_automation_events(id)
);
create or replace function private.crm_resolve_person(
  p_tenant_id uuid,p_domain text,p_record_id uuid
) returns uuid language sql stable security definer set search_path = ''
as $fixture$ select null::uuid $fixture$;
create or replace function public.crm_enqueue_campaign_trigger_jobs(
  p_event_id uuid
) returns integer language plpgsql security definer set search_path = ''
as $fixture$
begin
  insert into public.crm_emitter_test_jobs(event_id)
  values(p_event_id) on conflict do nothing;
  return 1;
end;
$fixture$;
CREATE OR REPLACE FUNCTION public.crm_emit_automation_event(p_tenant_id uuid, p_event_type text, p_subject_type text, p_subject_id uuid, p_idempotency_key text, p_payload jsonb DEFAULT '{}'::jsonb, p_source text DEFAULT 'database'::text, p_source_event_id uuid DEFAULT NULL::uuid, p_occurred_at timestamp with time zone DEFAULT now())
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_person uuid;
  v_id uuid;
begin
  v_person := private.crm_resolve_person(p_tenant_id, p_subject_type, p_subject_id);

  insert into public.crm_automation_events (
    tenant_id, event_type, person_id, subject_type, subject_id,
    source, source_event_id, idempotency_key, payload, occurred_at
  )
  values (
    p_tenant_id, p_event_type, v_person, p_subject_type, p_subject_id,
    p_source, p_source_event_id, p_idempotency_key, coalesce(p_payload, '{}'::jsonb), p_occurred_at
  )
  on conflict (tenant_id, idempotency_key) do nothing
  returning id into v_id;

  if v_id is null then
    return null;
  end if;

  perform public.crm_enqueue_campaign_trigger_jobs(v_id);
  return v_id;
end;
$function$;
-- Match the production owner's effective nested SQL execution privileges.
alter function private.crm_resolve_person(uuid,text,uuid) owner to postgres;
alter function public.crm_enqueue_campaign_trigger_jobs(uuid) owner to postgres;
alter function public.crm_emit_automation_event(uuid,text,text,uuid,text,jsonb,text,uuid,timestamptz) owner to postgres;
revoke execute on function private.crm_resolve_person(uuid,text,uuid) from public,anon,authenticated;
revoke execute on function public.crm_enqueue_campaign_trigger_jobs(uuid) from public,anon,authenticated;
revoke execute on function public.crm_emit_automation_event(uuid,text,text,uuid,text,jsonb,text,uuid,timestamptz)
 from public,anon;
grant execute on function public.crm_emit_automation_event(uuid,text,text,uuid,text,jsonb,text,uuid,timestamptz)
 to authenticated,service_role;
-- Runner applies the UNMODIFIED source migration on this pre-hardening fixture.
