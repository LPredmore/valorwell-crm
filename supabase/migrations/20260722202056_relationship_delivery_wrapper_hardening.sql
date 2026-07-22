-- Pass 12: authenticated operators use public SECURITY DEFINER wrappers; private mutation routines remain inaccessible.

CREATE OR REPLACE FUNCTION public.set_relationship_campaign_execution(
  p_campaign_id uuid,
  p_expected_version bigint,
  p_enabled boolean,
  p_idempotency_key text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
SELECT private.set_relationship_campaign_execution(
  p_campaign_id,
  p_expected_version,
  p_enabled,
  p_idempotency_key,
  p_reason
);
$function$;

CREATE OR REPLACE FUNCTION public.update_relationship_reply(
  p_reply_id uuid,
  p_expected_version bigint,
  p_status text DEFAULT NULL,
  p_owner_profile_id uuid DEFAULT NULL,
  p_follow_up_due_at timestamptz DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
SELECT private.update_relationship_reply(
  p_reply_id,
  p_expected_version,
  p_status,
  p_owner_profile_id,
  p_follow_up_due_at,
  p_idempotency_key,
  p_reason
);
$function$;

REVOKE ALL ON FUNCTION private.update_relationship_reply(uuid,bigint,text,uuid,timestamptz,text,text)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.set_relationship_campaign_execution(uuid,bigint,boolean,text,text)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.update_relationship_reply(uuid,bigint,text,uuid,timestamptz,text,text)
  FROM PUBLIC,anon,authenticated;

GRANT EXECUTE ON FUNCTION public.set_relationship_campaign_execution(uuid,bigint,boolean,text,text)
  TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.update_relationship_reply(uuid,bigint,text,uuid,timestamptz,text,text)
  TO authenticated,service_role;
