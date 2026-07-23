-- Replace the CRM's Help Scout email transport with a provider-neutral Resend-only lane.
-- Historical Help Scout tables remain read-protected for audit retention but are no longer runtime dependencies.

CREATE TABLE IF NOT EXISTS public.crm_resend_email_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  from_name text,
  from_email text,
  reply_to_email text,
  inbound_email text,
  connection_status text NOT NULL DEFAULT 'disconnected',
  last_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_resend_email_settings_status_check
    CHECK (connection_status = ANY (ARRAY['disconnected','connected','error']::text[])),
  CONSTRAINT crm_resend_email_settings_from_email_check
    CHECK (from_email IS NULL OR lower(btrim(from_email)) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  CONSTRAINT crm_resend_email_settings_reply_to_email_check
    CHECK (reply_to_email IS NULL OR lower(btrim(reply_to_email)) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  CONSTRAINT crm_resend_email_settings_inbound_email_check
    CHECK (inbound_email IS NULL OR lower(btrim(inbound_email)) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  CONSTRAINT crm_resend_email_settings_connected_check
    CHECK (connection_status <> 'connected' OR (from_email IS NOT NULL AND inbound_email IS NOT NULL AND last_verified_at IS NOT NULL))
);
INSERT INTO public.crm_resend_email_settings (
  tenant_id, from_name, from_email, connection_status
)
SELECT tenant_id, from_name, lower(btrim(from_email)), 'disconnected'
FROM public.crm_helpscout_settings
WHERE from_email IS NOT NULL
  AND lower(btrim(from_email)) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
ON CONFLICT (tenant_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.crm_email_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  campaign_id uuid REFERENCES public.crm_campaigns(id) ON DELETE SET NULL,
  bulk_send_id uuid REFERENCES public.crm_bulk_send_logs(id) ON DELETE SET NULL,
  direction text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  sender_email text NOT NULL,
  recipient_email text NOT NULL,
  reply_to_email text,
  subject text,
  body_html text,
  body_text text,
  provider text NOT NULL DEFAULT 'resend',
  provider_message_id text,
  provider_thread_id text,
  in_reply_to_message_id uuid,
  message_class text,
  source text NOT NULL DEFAULT 'manual',
  sent_at timestamptz,
  delivered_at timestamptz,
  received_at timestamptz,
  failed_at timestamptz,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  error_code text,
  error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_email_messages_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT crm_email_messages_provider_message_key UNIQUE (provider, provider_message_id),
  CONSTRAINT crm_email_messages_direction_check
    CHECK (direction = ANY (ARRAY['outbound','inbound']::text[])),
  CONSTRAINT crm_email_messages_status_check
    CHECK (status = ANY (ARRAY[
      'queued','sent','delivered','delivery_delayed','failed','bounced','complained','suppressed','received'
    ]::text[])),
  CONSTRAINT crm_email_messages_provider_check CHECK (provider = 'resend'),
  CONSTRAINT crm_email_messages_sender_email_check
    CHECK (lower(btrim(sender_email)) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  CONSTRAINT crm_email_messages_recipient_email_check
    CHECK (lower(btrim(recipient_email)) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  CONSTRAINT crm_email_messages_reply_to_email_check
    CHECK (reply_to_email IS NULL OR lower(btrim(reply_to_email)) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  CONSTRAINT crm_email_messages_body_check
    CHECK (body_html IS NOT NULL OR body_text IS NOT NULL),
  CONSTRAINT crm_email_messages_metadata_check CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT crm_email_messages_direction_status_check CHECK (
    (direction = 'inbound' AND status = 'received')
    OR
    (direction = 'outbound' AND status <> 'received')
  ),
  CONSTRAINT crm_email_messages_tenant_reply_fkey
    FOREIGN KEY (tenant_id, in_reply_to_message_id)
    REFERENCES public.crm_email_messages(tenant_id, id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS crm_email_messages_tenant_client_occurred_idx
  ON public.crm_email_messages(tenant_id, client_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS crm_email_messages_tenant_status_occurred_idx
  ON public.crm_email_messages(tenant_id, status, occurred_at DESC);
CREATE INDEX IF NOT EXISTS crm_email_messages_tenant_campaign_idx
  ON public.crm_email_messages(tenant_id, campaign_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS crm_email_messages_tenant_bulk_idx
  ON public.crm_email_messages(tenant_id, bulk_send_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS crm_email_messages_tenant_thread_idx
  ON public.crm_email_messages(tenant_id, provider_thread_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS crm_email_messages_tenant_reply_idx
  ON public.crm_email_messages(tenant_id, in_reply_to_message_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS public.crm_email_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email_message_id uuid NOT NULL,
  provider text NOT NULL DEFAULT 'resend',
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_email_events_provider_check CHECK (provider = 'resend'),
  CONSTRAINT crm_email_events_provider_event_key UNIQUE (provider, provider_event_id),
  CONSTRAINT crm_email_events_payload_check CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT crm_email_events_tenant_message_fkey
    FOREIGN KEY (tenant_id, email_message_id)
    REFERENCES public.crm_email_messages(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS crm_email_events_tenant_message_occurred_idx
  ON public.crm_email_events(tenant_id, email_message_id, occurred_at DESC);

ALTER TABLE public.crm_campaign_step_logs
  ADD COLUMN IF NOT EXISTS resend_email_id text;
COMMENT ON COLUMN public.crm_campaign_step_logs.helpscout_conversation_id IS
  'Historical audit only. New campaign email deliveries use resend_email_id.';
CREATE INDEX IF NOT EXISTS crm_campaign_step_logs_resend_email_idx
  ON public.crm_campaign_step_logs(resend_email_id)
  WHERE resend_email_id IS NOT NULL;

ALTER TABLE public.crm_resend_email_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_email_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_email_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_resend_email_settings_select ON public.crm_resend_email_settings;
CREATE POLICY crm_resend_email_settings_select
  ON public.crm_resend_email_settings
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.crm_user_capabilities capability
      WHERE capability.profile_id = (SELECT auth.uid())
        AND capability.tenant_id = crm_resend_email_settings.tenant_id
        AND capability.crm_role <> 'crm_none'::public.crm_capability_role
    )
  );

DROP POLICY IF EXISTS crm_resend_email_settings_insert ON public.crm_resend_email_settings;
CREATE POLICY crm_resend_email_settings_insert
  ON public.crm_resend_email_settings
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.crm_user_capabilities capability
      WHERE capability.profile_id = (SELECT auth.uid())
        AND capability.tenant_id = crm_resend_email_settings.tenant_id
        AND capability.crm_role = ANY (ARRAY[
          'crm_admin'::public.crm_capability_role,
          'crm_operator'::public.crm_capability_role
        ])
    )
  );

DROP POLICY IF EXISTS crm_resend_email_settings_update ON public.crm_resend_email_settings;
CREATE POLICY crm_resend_email_settings_update
  ON public.crm_resend_email_settings
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.crm_user_capabilities capability
      WHERE capability.profile_id = (SELECT auth.uid())
        AND capability.tenant_id = crm_resend_email_settings.tenant_id
        AND capability.crm_role = ANY (ARRAY[
          'crm_admin'::public.crm_capability_role,
          'crm_operator'::public.crm_capability_role
        ])
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.crm_user_capabilities capability
      WHERE capability.profile_id = (SELECT auth.uid())
        AND capability.tenant_id = crm_resend_email_settings.tenant_id
        AND capability.crm_role = ANY (ARRAY[
          'crm_admin'::public.crm_capability_role,
          'crm_operator'::public.crm_capability_role
        ])
    )
  );

DROP POLICY IF EXISTS crm_email_messages_select ON public.crm_email_messages;
CREATE POLICY crm_email_messages_select
  ON public.crm_email_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.crm_user_capabilities capability
      WHERE capability.profile_id = (SELECT auth.uid())
        AND capability.tenant_id = crm_email_messages.tenant_id
        AND capability.crm_role <> 'crm_none'::public.crm_capability_role
    )
  );

DROP POLICY IF EXISTS crm_email_events_select ON public.crm_email_events;
CREATE POLICY crm_email_events_select
  ON public.crm_email_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.crm_user_capabilities capability
      WHERE capability.profile_id = (SELECT auth.uid())
        AND capability.tenant_id = crm_email_events.tenant_id
        AND capability.crm_role <> 'crm_none'::public.crm_capability_role
    )
  );

REVOKE ALL ON public.crm_resend_email_settings, public.crm_email_messages, public.crm_email_events
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.crm_resend_email_settings TO authenticated;
GRANT SELECT ON public.crm_email_messages, public.crm_email_events TO authenticated;
GRANT ALL ON public.crm_resend_email_settings, public.crm_email_messages, public.crm_email_events TO service_role;

COMMENT ON TABLE public.crm_resend_email_settings IS
  'Per-tenant sender and inbound routing configuration for the CRM Resend-only email transport.';
COMMENT ON TABLE public.crm_email_messages IS
  'Canonical CRM email ledger. All active transport is through Resend.';
COMMENT ON TABLE public.crm_email_events IS
  'Replay-safe Resend webhook event ledger for canonical CRM email messages.';

-- Preserve historical records while ensuring the application cannot continue to use the retired provider.
DO $$
DECLARE
  legacy_table text;
BEGIN
  FOREACH legacy_table IN ARRAY ARRAY[
    'crm_helpscout_settings',
    'crm_conversation_links',
    'crm_conversation_cache'
  ]
  LOOP
    IF to_regclass('public.' || legacy_table) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', legacy_table);
      EXECUTE format(
        'COMMENT ON TABLE public.%I IS %L',
        legacy_table,
        'Retained for historical audit only. Help Scout was retired from the ValorWell CRM email runtime on 2026-07-23.'
      );
    END IF;
  END LOOP;
END $$;
