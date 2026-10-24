-- Store only SHA-256 of provider webhook verification tokens.
CREATE TABLE IF NOT EXISTS public.ringcentral_sms_webhook_token_hashes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 token_sha256 text NOT NULL UNIQUE CHECK(token_sha256 ~ '^[0-9a-f]{64}$'),
 subscription_id text,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','active','disabled')),
 enabled boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ringcentral_sms_webhook_enabled_digest_idx
 ON public.ringcentral_sms_webhook_token_hashes(token_sha256) WHERE enabled;
ALTER TABLE public.ringcentral_sms_webhook_token_hashes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ringcentral_sms_webhook_token_hashes FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.ringcentral_sms_webhook_token_hashes TO service_role;
