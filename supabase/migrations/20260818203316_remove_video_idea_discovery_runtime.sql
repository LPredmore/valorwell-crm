-- Retire all active video-idea discovery runtime paths.

-- Remove any queued/completed work items specific to content-opportunity discovery.
delete from private.ai_ops_work_items
where work_type = 'content_opportunity_review' or module = 'content_opportunities';

-- Remove generated feature output and feature-specific run history from the live UI/state.
delete from public.ai_operations_findings where module = 'content_opportunities';
delete from public.ai_operations_module_runs where module = 'content_opportunities';
delete from public.ai_operations_content_opportunities;
delete from public.ai_operations_viral_short_candidates;
delete from public.ai_operations_viral_short_runs;

-- Remove the feature flag so the module cannot be re-enabled from the dashboard.
delete from private.ai_ops_flags where flag_name = 'content_opportunities_ai_enabled';

-- Remove the database entry points that create/ingest long-form video ideas.
drop function if exists public.ai_ops_build_content_opportunity_input(uuid, uuid, timestamptz);
drop function if exists public.ai_ops_ingest_content_opportunities(uuid, uuid);

-- Remove the dedicated Shorts scheduler wrapper.
drop function if exists private.run_ai_ops_viral_shorts();

-- Remove Viral Shorts from the generic AI Operations Edge invocation allow-list.
create or replace function private.ai_ops_invoke(
  p_function text,
  p_body jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'private'
as $function$
declare
  v_request_id bigint;
  v_secret text;
begin
  if p_function not in ('ai-operations-dispatcher', 'ai-operations-model-worker', 'ai-operations-youtube-sync') then
    raise exception 'Unsupported AI Operations function: %', p_function;
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets where name = 'cron_secret' limit 1;
  if v_secret is null then
    raise exception 'cron_secret is not configured.';
  end if;

  select net.http_post(
    url := 'https://ahqauomkgflopxgnlndd.supabase.co/functions/v1/' || p_function,
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Cron-Secret', v_secret),
    body := coalesce(p_body, '{}'::jsonb),
    timeout_milliseconds := 180000
  ) into v_request_id;

  return v_request_id;
end;
$function$;

-- Remove the retired module from finding-category semantics while leaving the enum value
-- in place to avoid a risky enum rewrite that could affect historical AI Operations rows.
create or replace function private.ai_ops_finding_category(p_module ai_ops_module_enum)
returns text
language sql
immutable
set search_path to ''
as $function$
  select case p_module
    when 'client_journey' then 'client_care'
    when 'staff_quality' then 'staff'
    when 'appointment_integrity' then 'appointments'
    when 'billing_claims' then 'billing'
    when 'communications' then 'communications'
    when 'relationship_followup' then 'relationships'
    when 'donor_intelligence' then 'donors_growth'
    when 'bty_intelligence' then 'beyond_the_yellow'
    when 'social_leads' then 'marketing_content'
    when 'content_performance' then 'marketing_content'
    when 'data_quality' then 'data_quality'
    when 'sop_compliance' then 'compliance_sop'
    else 'system_health'
  end
$function$;
