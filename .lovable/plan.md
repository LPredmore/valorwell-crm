
# Plan: Add RingCentral Webhook Validation Handshake

## The Problem

When you create a webhook subscription in RingCentral, it sends a **validation request** to your endpoint. This request:
- Contains a `Validation-Token` header
- Has **no JSON body** (or minimal body)
- Expects you to echo back the same token in the response header

The current code tries to parse JSON immediately, which fails during validation.

---

## How RingCentral Validation Works

```text
RingCentral                          Your Edge Function
    |                                        |
    |  POST with Validation-Token header     |
    |--------------------------------------->|
    |                                        |
    |  Response with same Validation-Token   |
    |<---------------------------------------|
    |                                        |
    |  Subscription created successfully!    |
```

---

## Changes Required

### File: `supabase/functions/ringcentral-sms/index.ts`

Update the `handleInboundSms` function (lines 323-459) to check for the validation token **first**, before attempting to parse JSON.

**Current flow (lines 328-329):**
```typescript
try {
  const payload = await req.json();  // ❌ Fails if no JSON body
```

**New flow:**
```typescript
try {
  // Check for RingCentral webhook validation request FIRST
  const validationToken = req.headers.get('Validation-Token');
  
  if (validationToken) {
    console.log('RingCentral webhook validation - echoing token');
    return new Response('', {
      status: 200,
      headers: { 
        ...corsHeaders, 
        'Validation-Token': validationToken 
      },
    });
  }

  // Now safe to parse JSON for actual webhook events
  const payload = await req.json();
```

---

## Summary

| Aspect | Details |
|--------|---------|
| File | `supabase/functions/ringcentral-sms/index.ts` |
| Function | `handleInboundSms` (lines 323-459) |
| Change | Add validation token check before JSON parsing |
| Result | RingCentral can successfully create the webhook subscription |

---

## After This Change

Once deployed, you can:
1. Go back to the RingCentral API Explorer
2. Navigate to **Events and Notifications** → **Subscriptions** → **Create Subscription**
3. Create the subscription - it will now succeed because the validation handshake works
