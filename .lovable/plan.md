
# Plan: Add HelpScout Webhook Signature Validation

## Overview

Now that you've added the `HELPSCOUT_WEBHOOK_SECRET` to Supabase, I need to update the `handleWebhook` function to validate incoming requests using HelpScout's signature verification.

---

## How HelpScout Webhook Signatures Work

HelpScout sends a signature in the `X-HelpScout-Signature` header. This signature is:
1. A Base64-encoded HMAC-SHA1 hash of the raw request body
2. Using your secret key as the HMAC key

To validate, we compute the same hash and compare.

---

## Changes Required

### File: `supabase/functions/helpscout-proxy/index.ts`

Update the `handleWebhook` function (lines 809-928) to:

1. **Read the raw request body first** (before parsing JSON)
2. **Get the signature header** from `X-HelpScout-Signature`
3. **Compute HMAC-SHA1** of the raw body using the secret
4. **Compare signatures** - reject if they don't match
5. **Then parse the JSON** and continue with existing logic

```typescript
async function handleWebhook(req: Request): Promise<Response> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const webhookSecret = Deno.env.get("HELPSCOUT_WEBHOOK_SECRET");
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Get raw body for signature validation
    const rawBody = await req.text();
    
    // Validate signature if secret is configured
    if (webhookSecret) {
      const signature = req.headers.get("X-HelpScout-Signature");
      
      if (!signature) {
        console.error("Missing X-HelpScout-Signature header");
        return new Response(JSON.stringify({ error: "Missing signature" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Compute HMAC-SHA1 of body using secret
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(webhookSecret),
        { name: "HMAC", hash: "SHA-1" },
        false,
        ["sign"]
      );
      const signatureBytes = await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(rawBody)
      );
      
      // Convert to Base64 for comparison
      const computedSignature = btoa(
        String.fromCharCode(...new Uint8Array(signatureBytes))
      );

      if (computedSignature !== signature) {
        console.error("Invalid webhook signature");
        return new Response(JSON.stringify({ error: "Invalid signature" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      console.log("Webhook signature validated successfully");
    } else {
      console.warn("HELPSCOUT_WEBHOOK_SECRET not configured - skipping signature validation");
    }

    // Parse the body (we already read it as text, so parse manually)
    const payload = JSON.parse(rawBody);
    
    // ... rest of existing logic unchanged ...
  }
}
```

---

## Security Considerations

- **Signature validation runs first** before any database operations
- **If secret is not set**, logs a warning but still processes (graceful degradation during setup)
- **401 status returned** for invalid/missing signatures (standard for auth failures)
- Uses Web Crypto API (available in Deno) for secure HMAC computation

---

## Summary

| Aspect | Change |
|--------|--------|
| File | `supabase/functions/helpscout-proxy/index.ts` |
| Function | `handleWebhook` (lines 809-928) |
| Addition | HMAC-SHA1 signature validation using `HELPSCOUT_WEBHOOK_SECRET` |
| Behavior | Rejects requests with invalid/missing signatures (401) |

---

## After Implementation

Once deployed, you can test by:
1. Sending a test webhook from HelpScout
2. Checking the Edge Function logs to confirm "Webhook signature validated successfully"

