
-- RPC: Bulk update client status with atomic activity logging
CREATE OR REPLACE FUNCTION public.crm_bulk_update_client_status(
  p_client_ids uuid[],
  p_new_status pat_status_enum,
  p_tenant_id uuid,
  p_actor_profile_id uuid
)
RETURNS TABLE(client_id uuid, old_status pat_status_enum, new_status pat_status_enum)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verify caller belongs to tenant
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_memberships tm
    WHERE tm.tenant_id = p_tenant_id AND tm.profile_id = p_actor_profile_id
  ) THEN
    RAISE EXCEPTION 'Not authorized for tenant %', p_tenant_id USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH old AS (
    SELECT c.id, c.pat_status AS old_st
    FROM public.clients c
    WHERE c.id = ANY(p_client_ids) AND c.tenant_id = p_tenant_id
    FOR UPDATE
  ),
  upd AS (
    UPDATE public.clients c
    SET pat_status = p_new_status
    FROM old
    WHERE c.id = old.id
    RETURNING c.id, old.old_st, c.pat_status
  ),
  logged AS (
    INSERT INTO public.crm_activity_events
      (tenant_id, client_id, event_type, old_value, new_value, created_by_profile_id, metadata)
    SELECT p_tenant_id, upd.id, 'status_change',
           upd.old_st::text, upd.pat_status::text, p_actor_profile_id, '{}'::jsonb
    FROM upd
    RETURNING 1
  )
  SELECT upd.id, upd.old_st, upd.pat_status FROM upd;
END;
$$;

GRANT EXECUTE ON FUNCTION public.crm_bulk_update_client_status(uuid[], pat_status_enum, uuid, uuid) TO authenticated;

-- RPC: Atomically replace all steps for a campaign
CREATE OR REPLACE FUNCTION public.crm_save_campaign_steps(
  p_campaign_id uuid,
  p_tenant_id uuid,
  p_steps jsonb
)
RETURNS SETOF public.crm_campaign_steps
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kept_ids uuid[];
BEGIN
  -- Verify caller has access via tenant
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_memberships tm
    WHERE tm.tenant_id = p_tenant_id AND tm.profile_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not authorized for tenant %', p_tenant_id USING ERRCODE = '42501';
  END IF;

  -- Verify campaign belongs to tenant
  IF NOT EXISTS (
    SELECT 1 FROM public.crm_campaigns
    WHERE id = p_campaign_id AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Campaign not found' USING ERRCODE = '42704';
  END IF;

  -- Collect existing step IDs that appear in payload
  SELECT COALESCE(array_agg((s->>'id')::uuid), ARRAY[]::uuid[])
  INTO v_kept_ids
  FROM jsonb_array_elements(p_steps) s
  WHERE s->>'id' IS NOT NULL AND s->>'id' <> '';

  -- Delete steps not in payload
  DELETE FROM public.crm_campaign_steps
  WHERE campaign_id = p_campaign_id
    AND tenant_id = p_tenant_id
    AND NOT (id = ANY(v_kept_ids));

  -- Upsert each step
  INSERT INTO public.crm_campaign_steps
    (id, campaign_id, tenant_id, step_order, delay_days, delay_hours,
     channel, email_subject, email_body_html, sms_body_text, is_active, signature_id)
  SELECT
    COALESCE(NULLIF(s->>'id','')::uuid, gen_random_uuid()),
    p_campaign_id,
    p_tenant_id,
    (s->>'step_order')::int,
    COALESCE((s->>'delay_days')::int, 0),
    COALESCE((s->>'delay_hours')::int, 0),
    s->>'channel',
    CASE WHEN s->>'channel' = 'email' THEN s->>'email_subject' END,
    CASE WHEN s->>'channel' = 'email' THEN s->>'email_body_html' END,
    CASE WHEN s->>'channel' = 'sms'   THEN s->>'sms_body_text'   END,
    COALESCE((s->>'is_active')::boolean, true),
    CASE WHEN s->>'channel' = 'email' AND NULLIF(s->>'signature_id','') IS NOT NULL
         THEN (s->>'signature_id')::uuid END
  FROM jsonb_array_elements(p_steps) s
  ON CONFLICT (id) DO UPDATE SET
    step_order      = EXCLUDED.step_order,
    delay_days      = EXCLUDED.delay_days,
    delay_hours     = EXCLUDED.delay_hours,
    channel         = EXCLUDED.channel,
    email_subject   = EXCLUDED.email_subject,
    email_body_html = EXCLUDED.email_body_html,
    sms_body_text   = EXCLUDED.sms_body_text,
    is_active       = EXCLUDED.is_active,
    signature_id    = EXCLUDED.signature_id,
    updated_at      = now();

  RETURN QUERY
  SELECT * FROM public.crm_campaign_steps
  WHERE campaign_id = p_campaign_id AND tenant_id = p_tenant_id
  ORDER BY step_order ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.crm_save_campaign_steps(uuid, uuid, jsonb) TO authenticated;
