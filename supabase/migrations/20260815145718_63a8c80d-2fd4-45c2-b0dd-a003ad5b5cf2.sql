CREATE OR REPLACE FUNCTION private.ai_ops_invoke(p_function text, p_body jsonb DEFAULT '{}'::jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  v_request_id bigint;
  v_secret text;
begin
  if p_function not in ('ai-operations-dispatcher', 'ai-operations-model-worker') then
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

REVOKE ALL ON FUNCTION private.ai_ops_invoke(text, jsonb) FROM PUBLIC;
