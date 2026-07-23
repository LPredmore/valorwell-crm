import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "npm:resend@6.0.2";
import { checkSuppression, type MessageClass } from "../_shared/suppression.ts";

const RESEND_API = "https://api.resend.com";
const USER_AGENT = "ValorWell-CRM/1.0";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Db = ReturnType<typeof createClient>;
type Auth = { userId: string; tenantId: string; db: Db };
type Settings = {
  tenant_id: string;
  from_name: string | null;
  from_email: string | null;
  reply_to_email: string | null;
  inbound_email: string | null;
  connection_status: string;
};
type SendInput = {
  tenantId?: string;
  clientId: string;
  subject: string;
  text?: string;
  html?: string;
  messageClass?: MessageClass;
  campaignId?: string | null;
  bulkSendId?: string | null;
  inReplyToMessageId?: string | null;
  source?: string;
};
type EmailRow = {
  id: string;
  tenant_id: string;
  client_id: string | null;
  campaign_id: string | null;
  bulk_send_id: string | null;
  sender_email: string;
  recipient_email: string;
  subject: string | null;
  body_html: string | null;
  body_text: string | null;
  provider_message_id: string | null;
  provider_thread_id: string | null;
  in_reply_to_message_id: string | null;
  message_class: string | null;
  status: string;
  occurred_at: string;
  created_at: string;
};
type OutboundReplyContext = {
  id: string;
  client_id: string | null;
  campaign_id: string | null;
  provider_message_id: string | null;
  provider_thread_id: string | null;
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "content-type": "application/json" },
});
const normalizeEmail = (value: string) => value.trim().toLowerCase();
const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
const firstAddress = (value: unknown) => Array.isArray(value)
  ? String(value[0] ?? "").trim()
  : String(value ?? "").split(",")[0]?.trim() ?? "";
const bareEmail = (value: string) => normalizeEmail(value.match(/<([^>]+)>/)?.[1] ?? value);
const htmlFromText = (text: string) => text
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/\n/g, "<br>");

function headerValue(headers: unknown, name: string): string | undefined {
  if (Array.isArray(headers)) {
    const row = headers.find((item) =>
      typeof item === "object" && item !== null &&
      String((item as Record<string, unknown>).name ?? "").toLowerCase() === name.toLowerCase()
    );
    return row ? String((row as Record<string, unknown>).value ?? "") || undefined : undefined;
  }
  if (headers && typeof headers === "object") {
    const entry = Object.entries(headers as Record<string, unknown>)
      .find(([key]) => key.toLowerCase() === name.toLowerCase());
    return entry ? String(entry[1] ?? "") || undefined : undefined;
  }
  return undefined;
}

function displayFrom(settings: Settings): string {
  const email = normalizeEmail(settings.from_email ?? "");
  const name = String(settings.from_name ?? "").replace(/[<>\r\n]/g, "").trim();
  return name ? `${name} <${email}>` : email;
}

function taggedReplyTo(settings: Settings, messageId: string): string | undefined {
  const email = normalizeEmail(settings.inbound_email || settings.reply_to_email || "");
  const [local, domain] = email.split("@");
  return local && domain ? `${local.split("+")[0]}+crm-${messageId}@${domain}` : email || undefined;
}

function messageHintFromRecipient(value: unknown): string | null {
  const local = bareEmail(firstAddress(value)).split("@")[0] ?? "";
  return local.match(/\+crm-([0-9a-f-]{36})$/i)?.[1] ?? null;
}

async function authenticate(request: Request, requestedTenantId?: string): Promise<Auth> {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) throw new Error("UNAUTHORIZED");

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !anon || !service) throw new Error("SERVER_NOT_CONFIGURED");

  const userDb = createClient(url, anon, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data, error } = await userDb.auth.getClaims(authorization.slice(7));
  const userId = data?.claims?.sub;
  if (error || !userId) throw new Error("UNAUTHORIZED");

  const db = createClient(url, service, { auth: { persistSession: false } });
  let query = db.from("crm_user_capabilities")
    .select("tenant_id, crm_role")
    .eq("profile_id", userId)
    .neq("crm_role", "crm_none");
  if (requestedTenantId) query = query.eq("tenant_id", requestedTenantId);
  const { data: capability, error: capabilityError } = await query.limit(1).maybeSingle();
  if (capabilityError || !capability?.tenant_id) throw new Error("FORBIDDEN");

  return { userId, tenantId: capability.tenant_id, db };
}

async function settingsFor(db: Db, tenantId: string, requireConnected = true): Promise<Settings> {
  const { data, error } = await db.from("crm_resend_email_settings")
    .select("tenant_id, from_name, from_email, reply_to_email, inbound_email, connection_status")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.from_email) throw new Error("Resend sender settings are not configured");
  if (requireConnected && data.connection_status !== "connected") {
    throw new Error("Resend sender settings have not been verified");
  }
  return data as Settings;
}

async function clientFor(db: Db, tenantId: string, clientId: string) {
  const { data, error } = await db.from("clients")
    .select("id, tenant_id, email")
    .eq("id", clientId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Client not found in tenant");
  return data;
}

async function enforcePolicy(
  tenantId: string,
  clientId: string,
  messageClass: MessageClass,
  workflow: string,
  correlationId?: string | null,
  campaignId?: string | null,
) {
  const decision = await checkSuppression(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { tenantId, clientId, channel: "email", messageClass, workflow, correlationId, campaignId },
  );
  if (!decision.allowed) throw new Error(`SUPPRESSED:${decision.reason_code}`);
}

async function markFailed(
  db: Db,
  messageId: string,
  errorCode: string,
  errorMessage: string,
): Promise<void> {
  const failedAt = new Date().toISOString();
  await db.from("crm_email_messages").update({
    status: "failed",
    failed_at: failedAt,
    error_code: errorCode,
    error_message: errorMessage,
    updated_at: failedAt,
  }).eq("id", messageId);
}

async function deliver(
  db: Db,
  auth: { tenantId: string; userId: string | null },
  recipient: string,
  settings: Settings,
  input: Omit<SendInput, "clientId"> & { clientId: string | null },
): Promise<EmailRow> {
  const text = String(input.text ?? "");
  const html = String(input.html ?? (text ? htmlFromText(text) : ""));
  const now = new Date().toISOString();
  const { data: queued, error: insertError } = await db.from("crm_email_messages").insert({
    tenant_id: auth.tenantId,
    client_id: input.clientId,
    campaign_id: input.campaignId ?? null,
    bulk_send_id: input.bulkSendId ?? null,
    direction: "outbound",
    status: "queued",
    sender_email: normalizeEmail(settings.from_email ?? ""),
    recipient_email: normalizeEmail(recipient),
    reply_to_email: settings.reply_to_email ? normalizeEmail(settings.reply_to_email) : null,
    subject: input.subject,
    body_html: html || null,
    body_text: text || null,
    provider: "resend",
    message_class: input.messageClass ?? "necessary_scheduling",
    source: input.source ?? "manual",
    in_reply_to_message_id: input.inReplyToMessageId ?? null,
    created_by_profile_id: auth.userId,
    occurred_at: now,
  }).select("*").single();
  if (insertError) throw new Error(`Email log creation failed: ${insertError.message}`);

  let priorProviderId: string | null = null;
  if (input.inReplyToMessageId) {
    const { data } = await db.from("crm_email_messages")
      .select("provider_thread_id, provider_message_id")
      .eq("tenant_id", auth.tenantId)
      .eq("id", input.inReplyToMessageId)
      .maybeSingle();
    priorProviderId = data?.provider_thread_id ?? data?.provider_message_id ?? null;
  }

  const headers: Record<string, string> = { "X-CRM-Email-Message-ID": queued.id };
  if (priorProviderId) {
    headers["In-Reply-To"] = priorProviderId;
    headers.References = priorProviderId;
  }

  const apiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  if (!apiKey) {
    await markFailed(db, queued.id, "provider_not_configured", "RESEND_API_KEY not configured");
    throw new Error("RESEND_API_KEY not configured");
  }

  let response: Response;
  try {
    response = await fetch(`${RESEND_API}/emails`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "user-agent": USER_AGENT,
        "idempotency-key": `crm-email/${queued.id}`,
      },
      body: JSON.stringify({
        from: displayFrom(settings),
        to: [normalizeEmail(recipient)],
        reply_to: taggedReplyTo(settings, queued.id),
        subject: input.subject,
        text: text || undefined,
        html: html || undefined,
        headers,
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markFailed(db, queued.id, "network_error", message);
    throw error;
  }

  const provider = await response.json().catch(() => ({})) as {
    id?: string;
    message?: string;
    name?: string;
  };
  if (!response.ok || !provider.id) {
    const message = provider.message ?? "Resend rejected the delivery request";
    await markFailed(db, queued.id, provider.name ?? `http_${response.status}`, message);
    throw new Error(provider.message ?? `Resend send failed: ${response.status}`);
  }

  const sentAt = new Date().toISOString();
  const { data: sent, error: updateError } = await db.from("crm_email_messages").update({
    status: "sent",
    provider_message_id: provider.id,
    sent_at: sentAt,
    updated_at: sentAt,
  }).eq("id", queued.id).select("*").single();
  if (updateError) throw new Error(updateError.message);

  if (input.clientId) {
    await db.from("crm_activity_events").insert({
      tenant_id: auth.tenantId,
      client_id: input.clientId,
      event_type: "email_sent",
      created_by_profile_id: auth.userId,
      metadata: {
        provider: "resend",
        email_message_id: queued.id,
        provider_message_id: provider.id,
        source: input.source ?? "manual",
      },
    });
    await db.from("clients").update({
      last_contact_at: sentAt,
      last_contact_channel: "email",
      last_contact_direction: "sent",
    }).eq("id", input.clientId).eq("tenant_id", auth.tenantId);
  }

  return sent as EmailRow;
}

async function sendClient(auth: Auth, input: SendInput): Promise<EmailRow> {
  if (!input.clientId || !input.subject?.trim()) throw new Error("clientId and subject are required");
  if (!input.text?.trim() && !input.html?.trim()) throw new Error("Email body is required");

  const client = await clientFor(auth.db, auth.tenantId, input.clientId);
  if (!client.email || !isEmail(client.email)) throw new Error("Client does not have a valid email address");

  const messageClass = input.messageClass ??
    (input.campaignId ? "ordinary_campaign_follow_up" : "necessary_scheduling");
  await enforcePolicy(
    auth.tenantId,
    input.clientId,
    messageClass,
    input.source ?? "manual_email",
    null,
    input.campaignId,
  );

  return deliver(
    auth.db,
    auth,
    client.email,
    await settingsFor(auth.db, auth.tenantId),
    { ...input, messageClass },
  );
}

async function processBulk(auth: Auth, bulkSendId: string) {
  const { data: log, error } = await auth.db.from("crm_bulk_send_logs")
    .select("*")
    .eq("id", bulkSendId)
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();
  if (error || !log) throw new Error("Bulk send job not found");

  const settings = await settingsFor(auth.db, auth.tenantId);
  await auth.db.from("crm_bulk_send_logs").update({
    status: "in_progress",
    heartbeat_at: new Date().toISOString(),
  }).eq("id", bulkSendId);

  const recipientType = log.recipient_type || "client";
  const table = recipientType === "staff"
    ? "crm_bulk_send_staff_recipients"
    : "crm_bulk_send_recipients";
  const select = recipientType === "staff"
    ? "id, staff:staff_id(id, profile_id, profiles!staff_profile_id_fkey(email))"
    : "id, client:client_id(id, email)";
  const { data: recipients, error: recipientError } = await auth.db.from(table)
    .select(select)
    .eq("bulk_send_id", bulkSendId)
    .eq("status", "pending");
  if (recipientError) throw new Error(recipientError.message);

  let sent = 0;
  let failed = 0;
  for (const raw of recipients ?? []) {
    const row = raw as Record<string, any>;
    const client = row.client as { id?: string; email?: string } | undefined;
    const staff = row.staff as { profiles?: { email?: string } } | undefined;
    const clientId = recipientType === "client" ? client?.id ?? null : null;
    const email = recipientType === "client" ? client?.email : staff?.profiles?.email;

    try {
      if (!email || !isEmail(email)) throw new Error("No valid email address");
      if (clientId) {
        await enforcePolicy(
          auth.tenantId,
          clientId,
          "ordinary_promotional",
          "resend_bulk_send",
          bulkSendId,
        );
      }
      await deliver(
        auth.db,
        { tenantId: auth.tenantId, userId: auth.userId },
        email,
        settings,
        {
          clientId,
          subject: log.subject,
          html: log.body_html,
          messageClass: "ordinary_promotional",
          bulkSendId,
          source: "bulk",
        },
      );
      await auth.db.from(table).update({
        status: "sent",
        sent_at: new Date().toISOString(),
        error_message: null,
      }).eq("id", row.id);
      sent++;
    } catch (sendError) {
      await auth.db.from(table).update({
        status: "failed",
        sent_at: new Date().toISOString(),
        error_message: sendError instanceof Error ? sendError.message : String(sendError),
      }).eq("id", row.id);
      failed++;
    }

    await auth.db.from("crm_bulk_send_logs").update({
      sent_count: sent,
      failed_count: failed,
      heartbeat_at: new Date().toISOString(),
    }).eq("id", bulkSendId);
  }

  await auth.db.from("crm_bulk_send_logs").update({
    status: sent === 0 && failed > 0 ? "failed" : "completed",
    sent_count: sent,
    failed_count: failed,
    completed_at: new Date().toISOString(),
  }).eq("id", bulkSendId);

  return { bulkSendId, sent, failed };
}

async function testConnection(auth: Auth) {
  const settings = await settingsFor(auth.db, auth.tenantId, false);
  const from = normalizeEmail(settings.from_email ?? "");
  const inbound = normalizeEmail(settings.inbound_email ?? "");
  if (!isEmail(from) || !isEmail(inbound)) {
    throw new Error("Valid sender and inbound receiving addresses are required");
  }

  const apiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  if (!apiKey) throw new Error("RESEND_API_KEY not configured");

  const response = await fetch(`${RESEND_API}/domains`, {
    headers: { authorization: `Bearer ${apiKey}`, "user-agent": USER_AGENT },
  });
  const payload = await response.json().catch(() => ({})) as {
    data?: Array<{ name?: string; status?: string }>;
    message?: string;
  };
  if (!response.ok) throw new Error(payload.message ?? `Resend connection failed: ${response.status}`);

  const domains = Array.from(new Set([from.split("@")[1], inbound.split("@")[1]].filter(Boolean)));
  for (const domain of domains) {
    const found = (payload.data ?? []).find((row) => normalizeEmail(row.name ?? "") === domain);
    if (!found) throw new Error(`The ${domain} domain was not found in Resend`);
    if (found.status !== "verified") {
      throw new Error(`The ${domain} domain is ${found.status ?? "not verified"} in Resend`);
    }
  }

  const verifiedAt = new Date().toISOString();
  await auth.db.from("crm_resend_email_settings").update({
    connection_status: "connected",
    last_verified_at: verifiedAt,
    updated_at: verifiedAt,
  }).eq("tenant_id", auth.tenantId);

  return {
    connected: true,
    provider: "resend",
    fromEmail: from,
    inboundEmail: inbound,
    domains,
    domainStatus: "verified",
    verifiedAt,
  };
}

async function eventAlreadyExists(db: Db, eventId: string) {
  const { data } = await db.from("crm_email_events")
    .select("id")
    .eq("provider", "resend")
    .eq("provider_event_id", eventId)
    .maybeSingle();
  return !!data;
}

async function handleInbound(
  db: Db,
  event: Record<string, unknown>,
  data: Record<string, unknown>,
  eventId: string,
  occurredAt: string,
  apiKey: string,
) {
  const receivedId = String(data.email_id ?? data.id ?? "");
  if (!receivedId) return json({ error: "Inbound email ID is missing" }, 400);

  const response = await fetch(`${RESEND_API}/emails/receiving/${encodeURIComponent(receivedId)}`, {
    headers: { authorization: `Bearer ${apiKey}`, "user-agent": USER_AGENT },
  });
  const content = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) return json({ error: "Inbound email content could not be retrieved" }, 502);

  const toEmail = bareEmail(firstAddress(content.to ?? data.to));
  const fromEmail = bareEmail(firstAddress(content.from ?? data.from));
  if (!isEmail(toEmail) || !isEmail(fromEmail)) {
    return json({ received: true, ignored: true, reason: "invalid_inbound_address" });
  }

  const baseTo = toEmail.replace(/\+crm-[0-9a-f-]{36}(?=@)/i, "");
  const { data: settings } = await db.from("crm_resend_email_settings")
    .select("tenant_id, inbound_email")
    .ilike("inbound_email", baseTo)
    .limit(1)
    .maybeSingle();
  if (!settings?.tenant_id) {
    return json({ received: true, ignored: true, reason: "tenant_route_not_found" });
  }

  const headers = content.headers;
  const hintedId = headerValue(headers, "x-crm-email-message-id") ??
    messageHintFromRecipient(content.to ?? data.to);
  const inReplyTo = headerValue(headers, "in-reply-to");
  let outbound: OutboundReplyContext | null = null;

  if (hintedId) {
    const { data: row } = await db.from("crm_email_messages")
      .select("id, client_id, campaign_id, provider_message_id, provider_thread_id")
      .eq("tenant_id", settings.tenant_id)
      .eq("id", hintedId)
      .maybeSingle();
    outbound = row as OutboundReplyContext | null;
  }
  if (!outbound && inReplyTo) {
    const { data: row } = await db.from("crm_email_messages")
      .select("id, client_id, campaign_id, provider_message_id, provider_thread_id")
      .eq("tenant_id", settings.tenant_id)
      .or(`provider_message_id.eq.${inReplyTo},provider_thread_id.eq.${inReplyTo}`)
      .limit(1)
      .maybeSingle();
    outbound = row as OutboundReplyContext | null;
  }

  let clientId = outbound?.client_id ?? null;
  if (!clientId) {
    const { data: client } = await db.from("clients")
      .select("id")
      .eq("tenant_id", settings.tenant_id)
      .ilike("email", fromEmail)
      .limit(1)
      .maybeSingle();
    clientId = client?.id ?? null;
  }

  const subject = String(content.subject ?? data.subject ?? "") || null;
  const text = String(content.text ?? "");
  const html = String(content.html ?? "");
  const { data: inbound, error } = await db.from("crm_email_messages").insert({
    tenant_id: settings.tenant_id,
    client_id: clientId,
    campaign_id: outbound?.campaign_id ?? null,
    direction: "inbound",
    status: "received",
    sender_email: fromEmail,
    recipient_email: toEmail,
    subject,
    body_text: text || (html ? null : ""),
    body_html: html || null,
    provider: "resend",
    provider_message_id: receivedId,
    provider_thread_id: String(content.message_id ?? data.message_id ?? "") || inReplyTo || null,
    in_reply_to_message_id: outbound?.id ?? null,
    source: "inbound_webhook",
    received_at: occurredAt,
    occurred_at: occurredAt,
  }).select("*").single();
  if (error?.code === "23505") return json({ received: true, duplicate: true });
  if (error) return json({ error: error.message }, 500);

  const { error: eventError } = await db.from("crm_email_events").insert({
    tenant_id: settings.tenant_id,
    email_message_id: inbound.id,
    provider: "resend",
    provider_event_id: eventId,
    event_type: "email.received",
    occurred_at: occurredAt,
    payload: event,
  });
  if (eventError && eventError.code !== "23505") return json({ error: eventError.message }, 500);

  if (clientId) {
    await db.from("crm_activity_events").insert({
      tenant_id: settings.tenant_id,
      client_id: clientId,
      event_type: "email_received",
      created_by_profile_id: null,
      metadata: { provider: "resend", email_message_id: inbound.id },
    });
    await db.from("clients").update({
      last_contact_at: occurredAt,
      last_contact_channel: "email",
      last_contact_direction: "received",
    }).eq("id", clientId);

    const { data: active } = await db.from("crm_campaign_enrollments")
      .select("id")
      .eq("tenant_id", settings.tenant_id)
      .eq("client_id", clientId)
      .eq("status", "active");
    if (active?.length) {
      const activeIds = active
        .map((row: { id?: string }) => row.id)
        .filter((id: string | undefined): id is string => !!id);
      if (activeIds.length) {
        await db.from("crm_campaign_enrollments").update({
          status: "responded",
          paused_at: occurredAt,
          pause_reason: "email_response",
          updated_at: occurredAt,
        }).in("id", activeIds);
      }
    }
  }

  return json({ received: true, emailMessageId: inbound.id, clientId });
}

async function handleWebhook(request: Request) {
  const secret = Deno.env.get("RESEND_CRM_WEBHOOK_SECRET") ?? "";
  const apiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!secret || !apiKey || !url || !service) {
    return json({ error: "Resend webhook runtime is not configured" }, 503);
  }

  const rawBody = await request.text();
  const eventId = request.headers.get("svix-id") ?? "";
  const timestamp = request.headers.get("svix-timestamp") ?? "";
  const signature = request.headers.get("svix-signature") ?? "";
  if (!eventId || !timestamp || !signature) {
    return json({ error: "Resend webhook headers are missing" }, 400);
  }

  let event: Record<string, unknown>;
  try {
    event = new Resend(apiKey).webhooks.verify({
      payload: rawBody,
      headers: { id: eventId, timestamp, signature },
      webhookSecret: secret,
    }) as unknown as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid webhook signature" }, 401);
  }

  const db = createClient(url, service, { auth: { persistSession: false } });
  if (await eventAlreadyExists(db, eventId)) {
    return json({ received: true, duplicate: true });
  }

  const type = String(event.type ?? "");
  const data = (event.data && typeof event.data === "object" ? event.data : {}) as Record<string, unknown>;
  const occurredAt = String(event.created_at ?? new Date().toISOString());
  if (type === "email.received") {
    return handleInbound(db, event, data, eventId, occurredAt, apiKey);
  }

  const providerId = String(data.email_id ?? data.id ?? "");
  if (!providerId) {
    return json({ received: true, ignored: true, reason: "provider_message_id_missing" });
  }

  const { data: message } = await db.from("crm_email_messages")
    .select("*")
    .eq("provider", "resend")
    .eq("provider_message_id", providerId)
    .maybeSingle();
  if (!message) {
    return json({ received: true, ignored: true, reason: "email_message_not_found" });
  }

  const { error: eventError } = await db.from("crm_email_events").insert({
    tenant_id: message.tenant_id,
    email_message_id: message.id,
    provider: "resend",
    provider_event_id: eventId,
    event_type: type,
    occurred_at: occurredAt,
    payload: event,
  });
  if (eventError?.code === "23505") return json({ received: true, duplicate: true });
  if (eventError) return json({ error: eventError.message }, 500);

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const statusByEvent: Record<string, string> = {
    "email.sent": "sent",
    "email.delivered": "delivered",
    "email.delivery_delayed": "delivery_delayed",
    "email.bounced": "bounced",
    "email.complained": "complained",
    "email.suppressed": "suppressed",
    "email.failed": "failed",
  };
  if (statusByEvent[type]) updates.status = statusByEvent[type];
  if (type === "email.sent") updates.sent_at = occurredAt;
  if (type === "email.delivered") updates.delivered_at = occurredAt;
  if (["email.bounced", "email.complained", "email.suppressed", "email.failed"].includes(type)) {
    updates.failed_at = occurredAt;
    updates.error_code = type.replace("email.", "");
  }

  await db.from("crm_email_messages").update(updates).eq("id", message.id);
  return json({ received: true, emailMessageId: message.id, eventType: type });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(request.url);
  const action = url.searchParams.get("action");
  if (action === "webhook") return handleWebhook(request);

  let body: SendInput | null = null;
  try {
    if (action === "send") body = await request.json() as SendInput;
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  let auth: Auth;
  try {
    auth = await authenticate(
      request,
      body?.tenantId ?? url.searchParams.get("tenantId") ?? undefined,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNAUTHORIZED";
    return json({ error: message }, message === "FORBIDDEN" ? 403 : 401);
  }

  try {
    if (action === "test-connection") return json(await testConnection(auth));
    if (action === "send") {
      return json({ success: true, message: await sendClient(auth, body as SendInput) });
    }
    if (action === "bulk-send") {
      const bulkSendId = url.searchParams.get("bulkSendId") ?? "";
      if (!bulkSendId) return json({ error: "bulkSendId required" }, 400);
      return json(await processBulk(auth, bulkSendId));
    }
    return json({ error: "Invalid action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("SUPPRESSED:")) {
      return json({ error: "Communication suppressed", reason_code: message.slice(11) }, 403);
    }
    console.error("CRM Resend email function failed:", error);
    return json({ error: message }, 500);
  }
});
