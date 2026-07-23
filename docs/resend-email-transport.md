# CRM Resend-only email transport

## Scope

The CRM uses Resend for every active email delivery path:

- manual client email from the Communications composer
- bulk client and staff email
- clinical campaign email steps
- relationship campaign email
- inbound email and delivery-status webhooks

Help Scout is retired from the CRM runtime. Its historical database records remain audit-only and are not read or written by the application.

## Required Supabase secrets

- `RESEND_API_KEY` — a Resend API key with sending and domain-read access
- `RESEND_CRM_WEBHOOK_SECRET` — signing secret for the CRM email webhook
- `RESEND_RELATIONSHIP_WEBHOOK_SECRET` — existing signing secret for the separate relationship webhook

The CRM webhook URL is:

`https://ahqauomkgflopxgnlndd.supabase.co/functions/v1/crm-resend-email?action=webhook`

Subscribe the CRM webhook to at least:

- `email.sent`
- `email.delivered`
- `email.delivery_delayed`
- `email.bounced`
- `email.complained`
- `email.failed`
- `email.received`

## Deployment order

1. Apply `20260723090000_crm_resend_only_email_transport.sql`.
2. Deploy `crm-resend-email` with JWT verification disabled as specified in `supabase/config.toml`.
3. Deploy the updated `campaign-scheduler`, `relationship-campaign-worker`, and `relationship-resend-webhook` functions.
4. Configure the sender and inbound receiving address under CRM Settings → Resend Email, then run **Test connection**.
5. Configure the Resend webhook and verify an inbound reply appears in the CRM Communications inbox.
6. Remove the deployed `helpscout-proxy` Edge Function and delete the `HELPSCOUT_*` Edge Function secrets after confirming no rollback is required.

Do not activate or schedule the relationship campaign worker as part of this migration. Its existing production lock remains in force.
