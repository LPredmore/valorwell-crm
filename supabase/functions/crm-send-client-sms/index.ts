// CRM-owned individual SMS send.
//
// Isolates operator-initiated one-to-one SMS from the shared
// `ringcentral-sms` bulk/webhook function. All policy suppression,
// tenant authorization, and activity logging is enforced here so
// the CRM never depends on the bulk pipeline for individual sends.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  checkSuppression,
  type MessageClass,
} from "../_shared/suppression.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const RATE_LIMIT_RETRY_DELAY_MS = 30_000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePhoneNumber(
  phone: string | null,
): { valid: boolean; normalized: string | null; error?: string } {
  if (!phone) return { valid: false, normalized: null, error: "No phone number" };
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("1") && digits.length === 11) digits = digits.slice(1);
  if (digits.length !== 10) {
    return { valid: false, normalized: null, error: "Invalid phone format" };
  }
  return { valid: true, normalized: `+1${digits}` };
}

async function getAccessToken(): Promise<string> {
  const clientId = Deno.env.get("RINGCENTRAL_CLIENT_ID");
  const clientSecret = Deno.env.get("RINGCENTRAL_CLIENT_SECRET");
  const jwtToken = Deno.env.get("RINGCENTRAL_JWT_TOKEN");
  const serverUrl =
    Deno.env.get("RINGCENTRAL_SERVER_URL") || "https://platform.ringcentral.com";
  if (!clientId || !clientSecret || !jwtToken) {
    throw new Error("Missing RingCentral credentials");
  }
  const response = await fetch(`${serverUrl}/restapi/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwtToken,
    }),
  });
  if (!response.ok) {
    await response.text();
    throw new Error(`RingCentral authentication failed: ${response.status}`);
  }
  const data = await response.json() as { access_token: string };
  return data.access_token;
}

async function sendSms(
  token: string,
  toPhone: string,
  text: string,
): Promise<{ success: boolean; rateLimited?: boolean; error?: string }> {
  const serverUrl =
    Deno.env.get("RINGCENTRAL_SERVER_URL") || "https://platform.ringcentral.com";
  const fromNumber = Deno.env.get("RINGCENTRAL_FROM_NUMBER");
  if (!fromNumber) return { success: false, error: "Missing sender number" };

  const response = await fetch(
    `${serverUrl}/restapi/v1.0/account/~/extension/~/sms`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: { phoneNumber: fromNumber },
        to: [{ phoneNumber: toPhone }],
        text,
      }),
    },
  );

  if (response.status === 429) {
    await response.text();
    return { success: false, rateLimited: true, error: "Rate limited" };
  }
  if (!response.ok) {
    await response.text();
    return { success: false, error: `RingCentral error: ${response.status}` };
  }
  await response.text();
  return { success: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const userDb = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const token = authHeader.slice("Bearer ".length);
  const { data: claimsData, error: claimsError } = await userDb.auth.getClaims(token);
  if (claimsError || !claimsData?.claims?.sub) {
    return json({ error: "Invalid token" }, 401);
  }
  const actorId = claimsData.claims.sub as string;

  const body = await req.json().catch(() => null) as
    | {
      clientId?: string;
      body?: string;
      messageClass?: MessageClass;
      campaignId?: string | null;
      correlationId?: string | null;
    }
    | null;

  const clientId = typeof body?.clientId === "string" ? body.clientId : null;
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  if (!clientId || !text) {
    return json({ error: "clientId and body required" }, 400);
  }
  const messageClass: MessageClass = body?.messageClass ?? "necessary_scheduling";

  const db = createClient(supabaseUrl, serviceRoleKey);

  // Canonical read: resolve tenant and phone from the client record.
  const { data: client, error: clientErr } = await db
    .from("clients")
    .select("id, tenant_id, phone")
    .eq("id", clientId)
    .maybeSingle();
  if (clientErr || !client) return json({ error: "Client not found" }, 404);

  // Tenant authorization — actor must be a member of the client's tenant.
  const { data: membership } = await db
    .from("tenant_memberships")
    .select("tenant_id")
    .eq("profile_id", actorId)
    .eq("tenant_id", client.tenant_id)
    .maybeSingle();
  if (!membership) return json({ error: "Forbidden" }, 403);

  const normalized = normalizePhoneNumber(client.phone);
  if (!normalized.valid || !normalized.normalized) {
    return json({ error: normalized.error ?? "Invalid phone" }, 400);
  }

  const decision = await checkSuppression(supabaseUrl, serviceRoleKey, {
    tenantId: client.tenant_id,
    clientId: client.id,
    channel: "sms",
    messageClass,
    workflow: "crm_individual_sms",
    correlationId: body?.correlationId ?? null,
    campaignId: body?.campaignId ?? null,
  });
  if (!decision.allowed) {
    return json({
      error: "Communication suppressed",
      reason_code: decision.reason_code,
      policy_version: decision.policy_version,
    }, 403);
  }

  let rcToken: string;
  try {
    rcToken = await getAccessToken();
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }

  let result = await sendSms(rcToken, normalized.normalized, text);
  if (result.rateLimited) {
    await sleep(RATE_LIMIT_RETRY_DELAY_MS);
    result = await sendSms(rcToken, normalized.normalized, text);
  }
  if (!result.success) {
    return json({ error: result.error ?? "SMS send failed" }, 502);
  }

  const sentAt = new Date().toISOString();
  await db.from("crm_activity_events").insert({
    tenant_id: client.tenant_id,
    client_id: client.id,
    event_type: "sms_sent",
    created_by_profile_id: actorId,
    metadata: {
      source: "crm_individual",
      workflow: "crm_individual_sms",
      message_class: messageClass,
      to_phone: normalized.normalized,
      body: text,
      campaign_id: body?.campaignId ?? null,
    },
  });

  return json({ success: true, sentAt, to: normalized.normalized });
});
