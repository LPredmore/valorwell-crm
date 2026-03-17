

# Fix HelpScout Webhook 401 Unauthorized

## The Problem

Line 862 of `helpscout-proxy/index.ts` reads the wrong secret (`HELPSCOUT_APP_SECRET`) for webhook signature validation. It should read `HELPSCOUT_WEBHOOK_SECRET`.

## Changes

**File:** `supabase/functions/helpscout-proxy/index.ts`

**Line 862** -- change:
```
const webhookSecret = Deno.env.get("HELPSCOUT_APP_SECRET");
```
to:
```
const webhookSecret = Deno.env.get("HELPSCOUT_WEBHOOK_SECRET");
```

**Line 911** -- change:
```
console.warn("HELPSCOUT_APP_SECRET not configured - skipping signature validation");
```
to:
```
console.warn("HELPSCOUT_WEBHOOK_SECRET not configured - skipping signature validation");
```

## After Deploy

You need to manually re-enable the webhook in HelpScout since they disabled it:

1. Go to **HelpScout > Manage > Apps > Webhooks**
2. Confirm the callback URL and secret key are correct
3. Click **Save** to re-activate

