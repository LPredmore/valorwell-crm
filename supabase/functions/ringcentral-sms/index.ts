import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  applyRemove,
  checkSuppression,
  isRemoveMessage,
} from "../_shared/suppression.ts";

declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MESSAGE_DELAY_MS = 2000;
const RATE_LIMIT_RETRY_DELAY_MS = 30000;

interface RingCentralTokenResponse {
  access_token: string;
}

interface Recipient {
  id: string;
  clientId: string | null;
  phone: string | null;
  name: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const data: RingCentralTokenResponse = await response.json();
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

async function processBulkSms(bulkSmsId: string): Promise<void> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(supabaseUrl, serviceRoleKey);

  const { data: log, error: logError } = await db
    .from("crm_bulk_sms_logs")
    .select("*")
    .eq("id", bulkSmsId)
    .single();

  if (logError || !log) {
    console.error("Bulk SMS log not found:", logError?.message);
    return;
  }

  await db
    .from("crm_bulk_sms_logs")
    .update({ status: "sending", heartbeat_at: new Date().toISOString() })
    .eq("id", bulkSmsId);

  let recipients: Recipient[] = [];
  let recipientTable: string;

  if (log.recipient_type === "staff") {
    recipientTable = "crm_bulk_sms_staff_recipients";
    const { data, error } = await db
      .from(recipientTable)
      .select(`
        id,
        staff:staff_id (
          id,
          prov_phone,
          prov_name_f,
          prov_name_l
        )
      `)
      .eq("bulk_sms_id", bulkSmsId)
      .eq("status", "pending");
    if (error) throw new Error(error.message);
    recipients = (data || []).map((row: any) => ({
      id: row.id,
      clientId: null,
      phone: row.staff?.prov_phone ?? null,
      name: `${row.staff?.prov_name_f ?? ""} ${row.staff?.prov_name_l ?? ""}`.trim(),
    }));
  } else {
    recipientTable = "crm_bulk_sms_recipients";
    const { data, error } = await db
      .from(recipientTable)
      .select(`
        id,
        client:client_id (
          id,
          phone,
          pat_name_f,
          pat_name_l,
          pat_name_preferred
        )
      `)
      .eq("bulk_sms_id", bulkSmsId)
      .eq("status", "pending");
    if (error) throw new Error(error.message);
    recipients = (data || []).map((row: any) => ({
      id: row.id,
      clientId: row.client?.id ?? null,
      phone: row.client?.phone ?? null,
      name: `${row.client?.pat_name_preferred || row.client?.pat_name_f || ""} ${
        row.client?.pat_name_l || ""
      }`.trim(),
    }));
  }

  let token: string;
  try {
    token = await getAccessToken();
  } catch (error) {
    await db
      .from("crm_bulk_sms_logs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", bulkSmsId);
    throw error;
  }

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < recipients.length; i++) {
    const recipient = recipients[i];
    const normalized = normalizePhoneNumber(recipient.phone);

    if (!normalized.valid || !normalized.normalized) {
      await db
        .from(recipientTable)
        .update({ status: "failed", error_message: normalized.error })
        .eq("id", recipient.id);
      failed++;
      continue;
    }

    if (recipient.clientId) {
      const decision = await checkSuppression(supabaseUrl, serviceRoleKey, {
        tenantId: log.tenant_id,
        clientId: recipient.clientId,
        channel: "sms",
        messageClass: "ordinary_promotional",
        workflow: "ringcentral_bulk_sms",
        correlationId: bulkSmsId,
      });
      if (!decision.allowed) {
        await db
          .from(recipientTable)
          .update({
            status: "failed",
            error_message: `suppressed:${decision.reason_code}`,
          })
          .eq("id", recipient.id);
        failed++;
        continue;
      }
    }

    let result = await sendSms(token, normalized.normalized, log.body_text);
    if (result.rateLimited) {
      await sleep(RATE_LIMIT_RETRY_DELAY_MS);
      result = await sendSms(token, normalized.normalized, log.body_text);
    }

    if (result.success) {
      await db
        .from(recipientTable)
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", recipient.id);
      sent++;

      if (recipient.clientId) {
        await db.from("crm_activity_events").insert({
          tenant_id: log.tenant_id,
          client_id: recipient.clientId,
          event_type: "sms_sent",
          created_by_profile_id: null,
          metadata: {
            source: "bulk",
            workflow: "ringcentral_bulk_sms",
            bulk_sms_id: bulkSmsId,
          },
        });
      }
    } else {
      await db
        .from(recipientTable)
        .update({ status: "failed", error_message: result.error })
        .eq("id", recipient.id);
      failed++;
    }

    if ((i + 1) % 5 === 0 || i === recipients.length - 1) {
      await db
        .from("crm_bulk_sms_logs")
        .update({
          sent_count: sent,
          failed_count: failed,
          heartbeat_at: new Date().toISOString(),
        })
        .eq("id", bulkSmsId);
    }

    if (i < recipients.length - 1) await sleep(MESSAGE_DELAY_MS);
  }

  await db
    .from("crm_bulk_sms_logs")
    .update({
      status: failed === recipients.length && recipients.length > 0
        ? "failed"
        : "completed",
      sent_count: sent,
      failed_count: failed,
      completed_at: new Date().toISOString(),
    })
    .eq("id", bulkSmsId);
}

async function handleInbound(req: Request): Promise<Response> {
  const validationToken = req.headers.get("Validation-Token");
  if (validationToken) {
    return new Response("", {
      status: 200,
      headers: { ...corsHeaders, "Validation-Token": validationToken },
    });
  }

  const expectedToken = Deno.env.get("RINGCENTRAL_WEBHOOK_VERIFICATION_TOKEN");
  if (!expectedToken) return json({ error: "Webhook verification not configured" }, 500);
  if (req.headers.get("Verification-Token") !== expectedToken) {
    return json({ error: "Invalid verification token" }, 401);
  }

  const payload = await req.json();
  const fromNumber =
    payload.body?.from?.phoneNumber ||
    payload.from?.phoneNumber ||
    payload.body?.message?.from?.phoneNumber ||
    payload.message?.from?.phoneNumber;
  const toNumber =
    payload.body?.to?.[0]?.phoneNumber ||
    payload.to?.[0]?.phoneNumber ||
    Deno.env.get("RINGCENTRAL_FROM_NUMBER") ||
    "";
  const messageBody =
    payload.body?.subject ||
    payload.subject ||
    payload.body?.message?.subject ||
    payload.message?.subject ||
    null;
  const messageId =
    payload.body?.id?.toString() ||
    payload.id?.toString() ||
    payload.body?.message?.id?.toString() ||
    payload.message?.id?.toString() ||
    crypto.randomUUID();

  const normalized = normalizePhoneNumber(fromNumber ?? null);
  if (!normalized.valid || !normalized.normalized) {
    return json({ received: true, invalidPhone: true });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(supabaseUrl, serviceRoleKey);
  const last10 = normalized.normalized.replace(/\D/g, "").slice(-10);

  const { data: candidates, error } = await db
    .from("clients")
    .select("id, tenant_id, phone")
    .not("phone", "is", null)
    .or(
      `phone.ilike.%${last10.slice(0, 3)}%${last10.slice(3, 6)}%${last10.slice(6)}%,phone.ilike.%${last10}%`,
    )
    .limit(25);

  if (error) return json({ error: "Database error" }, 500);

  const matches = (candidates || []).filter((client: any) =>
    (client.phone || "").replace(/\D/g, "").slice(-10) === last10
  );
  const matched = matches[0] ?? null;

  await db.from("crm_inbound_sms_logs").insert({
    tenant_id: matched?.tenant_id ?? null,
    client_id: matched?.id ?? null,
    from_phone: normalized.normalized,
    to_phone: toNumber,
    message_body: messageBody,
    ringcentral_message_id: messageId,
    received_at: new Date().toISOString(),
    is_read: false,
  });

  if (!matched) return json({ received: true, clientFound: false });

  await db.from("crm_activity_events").insert({
    tenant_id: matched.tenant_id,
    client_id: matched.id,
    event_type: "sms_received",
    created_by_profile_id: null,
    metadata: { source: "webhook", ringcentral_message_id: messageId },
  });

  let removeApplied = false;
  if (isRemoveMessage(messageBody)) {
    const result = await applyRemove(supabaseUrl, serviceRoleKey, {
      tenantId: matched.tenant_id,
      clientId: matched.id,
      source: "ringcentral_inbound",
      correlationId: messageId,
    });
    if (!result.ok) {
      console.error("REMOVE failed:", result.error_code, result.message);
      return json({ error: "REMOVE processing failed" }, 500);
    }
    removeApplied = true;
  }

  const { data: active } = await db
    .from("crm_campaign_enrollments")
    .select("id")
    .eq("tenant_id", matched.tenant_id)
    .eq("client_id", matched.id)
    .eq("status", "active");

  if (active?.length) {
    await db
      .from("crm_campaign_enrollments")
      .update({
        status: "responded",
        paused_at: new Date().toISOString(),
        pause_reason: "sms_response",
        updated_at: new Date().toISOString(),
      })
      .in("id", active.map((row: any) => row.id));
  }

  return json({
    received: true,
    clientFound: true,
    removeApplied,
    enrollmentsPaused: active?.length ?? 0,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  if (url.searchParams.get("action") === "inbound") {
    try {
      return await handleInbound(req);
    } catch (error) {
      console.error("Inbound SMS error:", error);
      return json({ error: "Inbound processing failed" }, 500);
    }
  }

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
  if (claimsError || !claimsData?.claims?.sub) return json({ error: "Invalid token" }, 401);

  const body = await req.json();
  const db = createClient(supabaseUrl, serviceRoleKey);

  // ---- Individual SMS send ----------------------------------------------
  if (body.action === "send-individual") {
    const clientId = typeof body.clientId === "string" ? body.clientId : null;
    const text = typeof body.body === "string" ? body.body.trim() : "";
    if (!clientId || !text) return json({ error: "clientId and body required" }, 400);
    const messageClass = (body.messageClass as MessageClass | undefined) ??
      "necessary_scheduling";

    const { data: client, error: clientErr } = await db
      .from("clients")
      .select("id, tenant_id, phone")
      .eq("id", clientId)
      .maybeSingle();
    if (clientErr || !client) return json({ error: "Client not found" }, 404);

    const { data: membership } = await db
      .from("tenant_memberships")
      .select("tenant_id")
      .eq("profile_id", claimsData.claims.sub)
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
      workflow: "ringcentral_individual_sms",
      correlationId: body.correlationId ?? null,
      campaignId: body.campaignId ?? null,
    });
    if (!decision.allowed) {
      return json({
        error: "Communication suppressed",
        reason_code: decision.reason_code,
        policy_version: decision.policy_version,
      }, 403);
    }

    let token: string;
    try { token = await getAccessToken(); }
    catch (e) { return json({ error: (e as Error).message }, 502); }

    let result = await sendSms(token, normalized.normalized, text);
    if (result.rateLimited) {
      await sleep(RATE_LIMIT_RETRY_DELAY_MS);
      result = await sendSms(token, normalized.normalized, text);
    }
    if (!result.success) {
      return json({ error: result.error ?? "SMS send failed" }, 502);
    }

    const sentAt = new Date().toISOString();
    await db.from("crm_activity_events").insert({
      tenant_id: client.tenant_id,
      client_id: client.id,
      event_type: "sms_sent",
      created_by_profile_id: claimsData.claims.sub,
      metadata: {
        source: "individual",
        workflow: "ringcentral_individual_sms",
        message_class: messageClass,
        to_phone: normalized.normalized,
        body: text,
        campaign_id: body.campaignId ?? null,
      },
    });

    return json({ success: true, sentAt, to: normalized.normalized });
  }

  // ---- Bulk SMS dispatch (default) --------------------------------------
  const bulkSmsId = body.bulkSmsId;
  if (!bulkSmsId) return json({ error: "Missing bulkSmsId" }, 400);

  const { data: log } = await db
    .from("crm_bulk_sms_logs")
    .select("tenant_id")
    .eq("id", bulkSmsId)
    .maybeSingle();
  if (!log) return json({ error: "Bulk SMS job not found" }, 404);

  const { data: membership } = await db
    .from("tenant_memberships")
    .select("tenant_id")
    .eq("profile_id", claimsData.claims.sub)
    .eq("tenant_id", log.tenant_id)
    .maybeSingle();
  if (!membership) return json({ error: "Forbidden" }, 403);

  EdgeRuntime.waitUntil(processBulkSms(bulkSmsId));
  return json({ success: true, bulkSmsId });
});
