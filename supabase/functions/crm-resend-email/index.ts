import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "npm:resend@6.18.0";
import {
  prepareDirectEmailDelivery,
  stableSerialize,
  type CanonicalDirectEmailContent,
  type DirectEmailVariableValues,
} from "./email-content.ts";

const RESEND_API = "https://api.resend.com";
const USER_AGENT = "ValorWell-CRM/1.2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Db = ReturnType<typeof createClient>;
type AuthContext = {
  userId: string;
  tenantId: string;
  crmRole: string;
  db: Db;
};
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
  canonicalContent?: CanonicalDirectEmailContent;
  templateVersionId?: string | null;
  messageClass?: string;
  campaignId?: string | null;
  bulkSendId?: string | null;
  inReplyToMessageId?: string | null;
  source?: string;
};
type DeliveryInput = Omit<SendInput, "clientId" | "canonicalContent"> & {
  clientId: string | null;
  subject: string;
  text: string;
  html: string;
  preheader?: string | null;
  renderHash?: string | null;
  templateVersionId?: string | null;
  schemaVersion?: number | null;
  themeKey?: string | null;
};
type OutboundReplyContext = {
  id: string;
  client_id: string | null;
  campaign_id: string | null;
  provider_message_id: string | null;
  provider_thread_id: string | null;
};

const json = (body: unknown, status = 200, requestId?: string) => new Response(
  JSON.stringify(body),
  {
    status,
    headers: {
      ...corsHeaders,
      "content-type": "application/json",
      ...(requestId ? { "x-request-id": requestId } : {}),
    },
  },
);
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

function safeLog(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}) {
  const payload = JSON.stringify({ component: "crm-resend-email", event, ...fields });
  if (level === "error") console.error(payload);
  else if (level === "warn") console.warn(payload);
  else console.log(payload);
}

function headerValue(headers: unknown, name: string): string | undefined {
  if (Array.isArray(headers)) {
    const row = headers.find((item) =>
      typeof item === "object" && item !== null
      && String((item as Record<string, unknown>).name ?? "").toLowerCase() === name.toLowerCase()
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

async function authenticate(request: Request, requestedTenantId?: string): Promise<AuthContext> {
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
  const token = authorization.slice(7);
  const { data, error } = await userDb.auth.getClaims(token);
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

  return {
    userId,
    tenantId: capability.tenant_id,
    crmRole: capability.crm_role,
    db,
  };
}

function requireMutationAccess(auth: AuthContext) {
  if (auth.crmRole !== "crm_admin" && auth.crmRole !== "crm_operator") {
    throw new Error("FORBIDDEN");
  }
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
    .select("id, tenant_id, email, pat_name_f, pat_name_l, pat_name_preferred, primary_staff_id")
    .eq("id", clientId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Client not found in tenant");
  return data;
}

async function enforcePolicy(
  db: Db,
  tenantId: string,
  clientId: string,
  messageClass: string,
  workflow: string,
  correlationId?: string | null,
  campaignId?: string | null,
) {
  const { data: target, error: targetError } = await db.from("clients")
    .select("tenant_id")
    .eq("id", clientId)
    .maybeSingle();
  if (targetError || !target || target.tenant_id !== tenantId) {
    throw new Error("SUPPRESSED:unknown_canonical_state");
  }

  const { data, error } = await db.rpc("crm_evaluate_communication_policy", {
    p_client_id: clientId,
    p_channel: "email",
    p_message_class: messageClass,
  });
  const decision = data as { allowed?: boolean; reason_code?: string; policy_version?: string } | null;
  if (error || !decision) throw new Error("SUPPRESSED:unknown_canonical_state");
  if (!decision.allowed) {
    await db.from("crm_activity_events").insert({
      tenant_id: tenantId,
      client_id: clientId,
      event_type: "email_suppressed",
      created_by_profile_id: null,
      metadata: {
        reason_code: decision.reason_code ?? "unknown",
        policy_version: decision.policy_version ?? "unknown",
        channel: "email",
        message_class: messageClass,
        workflow,
        correlation_id: correlationId ?? null,
        campaign_id: campaignId ?? null,
      },
    });
    throw new Error(`SUPPRESSED:${decision.reason_code ?? "unknown"}`);
  }
}

async function markFailed(db: Db, messageId: string, errorCode: string, errorMessage: string) {
  const failedAt = new Date().toISOString();
  await db.from("crm_email_messages").update({
    status: "failed",
    failed_at: failedAt,
    error_code: errorCode,
    error_message: errorMessage,
    updated_at: failedAt,
  }).eq("id", messageId);
}

async function resolveDirectEmail(
  auth: AuthContext,
  settings: Settings,
  client: Awaited<ReturnType<typeof clientFor>>,
  input: SendInput,
): Promise<DeliveryInput> {
  if (!input.canonicalContent) {
    if (input.templateVersionId) throw new Error("TEMPLATE_VERSION_REQUIRES_CANONICAL_CONTENT");
    const text = String(input.text ?? "");
    const html = String(input.html ?? (text ? htmlFromText(text) : ""));
    if (!text.trim() && !html.trim()) throw new Error("Email body is required");
    return {
      ...input,
      clientId: input.clientId,
      subject: input.subject,
      text,
      html,
      preheader: null,
      renderHash: null,
      templateVersionId: null,
      schemaVersion: null,
      themeKey: null,
    };
  }

  let therapistName = "ValorWell Care Team";
  if (client.primary_staff_id) {
    const { data: staff } = await auth.db.from("staff")
      .select("prov_name_f, prov_name_l, prov_name_for_clients")
      .eq("tenant_id", auth.tenantId)
      .eq("id", client.primary_staff_id)
      .maybeSingle();
    if (staff) {
      therapistName = staff.prov_name_for_clients
        || [staff.prov_name_f, staff.prov_name_l].filter(Boolean).join(" ")
        || therapistName;
    }
  }

  const values: DirectEmailVariableValues = {
    first_name: client.pat_name_f || "Client",
    preferred_name: client.pat_name_preferred || client.pat_name_f || "Client",
    last_name: client.pat_name_l || "Client",
    therapist_name: therapistName,
    sender_name: settings.from_name || "ValorWell Care Team",
  };
  const prepared = await prepareDirectEmailDelivery({
    subjectTemplate: input.subject,
    content: input.canonicalContent,
    values,
  });

  if (input.templateVersionId) {
    const { data: version, error } = await auth.db.from("crm_email_template_versions")
      .select("id, content_scope, content_mode, subject, editor_document, rendered_html, rendered_text, preheader, theme_key, editor_schema_version, render_hash")
      .eq("tenant_id", auth.tenantId)
      .eq("id", input.templateVersionId)
      .maybeSingle();
    if (error || !version) throw new Error("EMAIL_TEMPLATE_VERSION_NOT_FOUND");
    if (version.content_scope !== "client" || version.content_mode !== "direct") {
      throw new Error("EMAIL_TEMPLATE_VERSION_SCOPE_INVALID");
    }
    const exactVersion = version.subject === input.subject
      && version.editor_schema_version === input.canonicalContent.schemaVersion
      && version.render_hash === input.canonicalContent.renderHash
      && version.rendered_html === input.canonicalContent.renderedHtml
      && version.rendered_text === input.canonicalContent.renderedText
      && (version.preheader ?? null) === (input.canonicalContent.preheader ?? null)
      && version.theme_key === input.canonicalContent.themeKey
      && stableSerialize(version.editor_document) === stableSerialize(input.canonicalContent.editorDocument);
    if (!exactVersion) throw new Error("EMAIL_TEMPLATE_VERSION_CONTENT_MISMATCH");
  }

  return {
    ...input,
    clientId: input.clientId,
    subject: prepared.subject,
    text: prepared.text,
    html: prepared.html,
    preheader: prepared.preheader,
    renderHash: prepared.renderHash,
    templateVersionId: input.templateVersionId ?? null,
    schemaVersion: prepared.schemaVersion,
    themeKey: prepared.themeKey,
  };
}

async function deliver(
  db: Db,
  auth: { tenantId: string; userId: string | null },
  recipient: string,
  settings: Settings,
  input: DeliveryInput,
) {
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
    body_html: input.html || null,
    body_text: input.text || null,
    preheader: input.preheader ?? null,
    render_hash: input.renderHash ?? null,
    template_version_id: input.templateVersionId ?? null,
    provider: "resend",
    message_class: input.messageClass ?? "necessary_scheduling",
    source: input.source ?? "manual",
    in_reply_to_message_id: input.inReplyToMessageId ?? null,
    metadata: {
      email_content_mode: input.renderHash ? "direct" : null,
      editor_schema_version: input.schemaVersion ?? null,
      theme_key: input.themeKey ?? null,
    },
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

  const providerHeaders: Record<string, string> = { "X-CRM-Email-Message-ID": queued.id };
  if (priorProviderId) {
    providerHeaders["In-Reply-To"] = priorProviderId;
    providerHeaders.References = priorProviderId;
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
        text: input.text || undefined,
        html: input.html || undefined,
        headers: providerHeaders,
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
    throw new Error(message);
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
        render_hash: input.renderHash ?? null,
        template_version_id: input.templateVersionId ?? null,
      },
    });
    await db.from("clients").update({
      last_contact_at: sentAt,
      last_contact_channel: "email",
      last_contact_direction: "sent",
    }).eq("id", input.clientId).eq("tenant_id", auth.tenantId);
  }

  return sent;
}

async function sendClient(auth: AuthContext, input: SendInput) {
  requireMutationAccess(auth);
  if (!input.clientId || !input.subject?.trim()) throw new Error("clientId and subject are required");
  const client = await clientFor(auth.db, auth.tenantId, input.clientId);
  if (!client.email || !isEmail(client.email)) throw new Error("Client does not have a valid email address");

  const messageClass = input.messageClass
    ?? (input.campaignId ? "ordinary_campaign_follow_up" : "necessary_scheduling");
  await enforcePolicy(
    auth.db,
    auth.tenantId,
    input.clientId,
    messageClass,
    input.source ?? "manual_email",
    null,
    input.campaignId,
  );

  const settings = await settingsFor(auth.db, auth.tenantId);
  const resolved = await resolveDirectEmail(auth, settings, client, { ...input, messageClass });
  return deliver(auth.db, auth, client.email, settings, resolved);
}

async function processBulk(auth: AuthContext, bulkSendId: string) {
  requireMutationAccess(auth);
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
          auth.db,
          auth.tenantId,
          clientId,
          "ordinary_promotional",
          "resend_bulk_send",
          bulkSendId,
        );
      }
      await deliver(auth.db, auth, email, settings, {
        clientId,
        subject: log.subject,
        text: log.body_text || "",
        html: log.body_html || htmlFromText(log.body_text || ""),
        messageClass: "ordinary_promotional",
        bulkSendId,
        source: "bulk",
      });
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

async function testConnection(auth: AuthContext, requestId: string) {
  requireMutationAccess(auth);
  const settings = await settingsFor(auth.db, auth.tenantId, false);
  const from = normalizeEmail(settings.from_email ?? "");
  const inbound = normalizeEmail(settings.inbound_email ?? "");
  if (!isEmail(from) || !isEmail(inbound)) {
    safeLog("warn", "test_connection_invalid_settings", {
      requestId,
      tenantId: auth.tenantId,
      hasFromEmail: Boolean(from),
      hasInboundEmail: Boolean(inbound),
    });
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
  safeLog(response.ok ? "info" : "warn", "test_connection_resend_response", {
    requestId,
    tenantId: auth.tenantId,
    status: response.status,
    fromDomain: from.split("@")[1] ?? null,
    inboundDomain: inbound.split("@")[1] ?? null,
    providerMessage: response.ok ? undefined : payload.message,
  });
  if (!response.ok) throw new Error(payload.message ?? `Resend connection failed: ${response.status}`);

  const domains = Array.from(new Set([from.split("@")[1], inbound.split("@")[1]].filter(Boolean)));
  for (const domain of domains) {
    const found = (payload.data ?? []).find((row) => normalizeEmail(row.name ?? "") === domain);
    if (!found) throw new Error(`The ${domain} domain was not found in Resend`);
    if (found.status !== "verified") throw new Error(`The ${domain} domain is ${found.status ?? "not verified"} in Resend`);
  }

  const verifiedAt = new Date().toISOString();
  const { error: updateError } = await auth.db.from("crm_resend_email_settings").update({
    connection_status: "connected",
    last_verified_at: verifiedAt,
    updated_at: verifiedAt,
  }).eq("tenant_id", auth.tenantId);
  if (updateError) throw new Error(`Unable to save connection status: ${updateError.message}`);
  return {
    connected: true,
    provider: "resend",
    fromEmail: from,
    inboundEmail: inbound,
    domains,
    domainStatus: "verified",
    verifiedAt,
    requestId,
  };
}

async function eventAlreadyExists(db: Db, eventId: string) {
  const { data } = await db.from("crm_email_events")
    .select("id")
    .eq("provider", "resend")
    .eq("provider_event_id", eventId)
    .maybeSingle();
  return Boolean(data);
}

async function handleInbound(
  db: Db,
  event: Record<string, unknown>,
  data: Record<string, unknown>,
  eventId: string,
  occurredAt: string,
  apiKey: string,
  requestId: string,
) {
  const receivedId = String(data.email_id ?? data.id ?? "");
  if (!receivedId) return json({ error: "Inbound email ID is missing", requestId }, 400, requestId);

  const response = await fetch(`${RESEND_API}/emails/receiving/${encodeURIComponent(receivedId)}`, {
    headers: { authorization: `Bearer ${apiKey}`, "user-agent": USER_AGENT },
  });
  const content = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) return json({ error: "Inbound email content could not be retrieved", requestId }, 502, requestId);

  const toEmail = bareEmail(firstAddress(content.to ?? data.to));
  const fromEmail = bareEmail(firstAddress(content.from ?? data.from));
  if (!isEmail(toEmail) || !isEmail(fromEmail)) {
    return json({ received: true, ignored: true, reason: "invalid_inbound_address", requestId }, 200, requestId);
  }

  const baseTo = toEmail.replace(/\+crm-[0-9a-f-]{36}(?=@)/i, "");
  const { data: settings } = await db.from("crm_resend_email_settings")
    .select("tenant_id, inbound_email")
    .ilike("inbound_email", baseTo)
    .limit(1)
    .maybeSingle();
  if (!settings?.tenant_id) {
    return json({ received: true, ignored: true, reason: "tenant_route_not_found", requestId }, 200, requestId);
  }

  const headers = content.headers;
  const hintedId = headerValue(headers, "x-crm-email-message-id")
    ?? messageHintFromRecipient(content.to ?? data.to);
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
  if (error?.code === "23505") return json({ received: true, duplicate: true, requestId }, 200, requestId);
  if (error) return json({ error: error.message, requestId }, 500, requestId);

  const { error: eventError } = await db.from("crm_email_events").insert({
    tenant_id: settings.tenant_id,
    email_message_id: inbound.id,
    provider: "resend",
    provider_event_id: eventId,
    event_type: "email.received",
    occurred_at: occurredAt,
    payload: event,
  });
  if (eventError && eventError.code !== "23505") return json({ error: eventError.message, requestId }, 500, requestId);

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
    const activeIds = (active ?? []).map((row: { id?: string }) => row.id).filter(Boolean);
    if (activeIds.length) {
      await db.from("crm_campaign_enrollments").update({
        status: "responded",
        paused_at: occurredAt,
        pause_reason: "email_response",
        updated_at: occurredAt,
      }).in("id", activeIds);
    }
  }

  return json({ received: true, emailMessageId: inbound.id, clientId, requestId }, 200, requestId);
}

async function handleWebhook(request: Request, requestId: string) {
  const secret = Deno.env.get("RESEND_CRM_WEBHOOK_SECRET") ?? "";
  const apiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!secret || !apiKey || !url || !service) {
    safeLog("error", "webhook_runtime_not_configured", {
      requestId,
      hasWebhookSecret: Boolean(secret),
      hasApiKey: Boolean(apiKey),
      hasSupabaseUrl: Boolean(url),
      hasServiceRoleKey: Boolean(service),
    });
    return json({ error: "Resend webhook runtime is not configured", requestId }, 503, requestId);
  }

  const rawBody = await request.text();
  const eventId = request.headers.get("svix-id") ?? "";
  const timestamp = request.headers.get("svix-timestamp") ?? "";
  const signature = request.headers.get("svix-signature") ?? "";
  if (!eventId || !timestamp || !signature) {
    return json({ error: "Resend webhook headers are missing", requestId }, 400, requestId);
  }

  let event: Record<string, unknown>;
  try {
    event = new Resend(apiKey).webhooks.verify({
      payload: rawBody,
      headers: { id: eventId, timestamp, signature },
      webhookSecret: secret,
    }) as unknown as Record<string, unknown>;
  } catch (error) {
    safeLog("warn", "webhook_signature_invalid", {
      requestId,
      eventId,
      message: error instanceof Error ? error.message : String(error),
    });
    return json({ error: "Invalid webhook signature", requestId }, 401, requestId);
  }

  const db = createClient(url, service, { auth: { persistSession: false } });
  if (await eventAlreadyExists(db, eventId)) {
    return json({ received: true, duplicate: true, requestId }, 200, requestId);
  }

  const type = String(event.type ?? "");
  const data = (event.data && typeof event.data === "object" ? event.data : {}) as Record<string, unknown>;
  const occurredAt = String(event.created_at ?? new Date().toISOString());
  safeLog("info", "webhook_received", { requestId, eventId, type });
  if (type === "email.received") {
    return handleInbound(db, event, data, eventId, occurredAt, apiKey, requestId);
  }

  const providerId = String(data.email_id ?? data.id ?? "");
  if (!providerId) {
    return json({ received: true, ignored: true, reason: "provider_message_id_missing", requestId }, 200, requestId);
  }

  const { data: message } = await db.from("crm_email_messages")
    .select("*")
    .eq("provider", "resend")
    .eq("provider_message_id", providerId)
    .maybeSingle();
  if (!message) {
    return json({ received: true, ignored: true, reason: "email_message_not_found", requestId }, 200, requestId);
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
  if (eventError?.code === "23505") return json({ received: true, duplicate: true, requestId }, 200, requestId);
  if (eventError) return json({ error: eventError.message, requestId }, 500, requestId);

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
  return json({ received: true, emailMessageId: message.id, eventType: type, requestId }, 200, requestId);
}

Deno.serve(async (request: Request) => {
  const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
  if (request.method === "OPTIONS") {
    safeLog("info", "cors_preflight", { requestId });
    return new Response("ok", { headers: { ...corsHeaders, "x-request-id": requestId } });
  }

  const url = new URL(request.url);
  const action = url.searchParams.get("action");
  safeLog("info", "request_started", { requestId, method: request.method, action });
  if (action === "webhook") return handleWebhook(request, requestId);

  let body: SendInput | null = null;
  try {
    if (action === "send") body = await request.json() as SendInput;
  } catch {
    return json({ error: "Invalid request body", requestId }, 400, requestId);
  }

  let auth: AuthContext;
  try {
    auth = await authenticate(
      request,
      body?.tenantId ?? url.searchParams.get("tenantId") ?? undefined,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNAUTHORIZED";
    safeLog("warn", "authentication_failed", { requestId, action, message });
    return json({ error: message, requestId }, message === "FORBIDDEN" ? 403 : 401, requestId);
  }

  try {
    if (action === "test-connection") return json(await testConnection(auth, requestId), 200, requestId);
    if (action === "send") {
      return json({ success: true, message: await sendClient(auth, body as SendInput), requestId }, 200, requestId);
    }
    if (action === "bulk-send") {
      const bulkSendId = url.searchParams.get("bulkSendId") ?? "";
      if (!bulkSendId) return json({ error: "bulkSendId required", requestId }, 400, requestId);
      return json({ ...(await processBulk(auth, bulkSendId)), requestId }, 200, requestId);
    }
    return json({ error: "Invalid action", requestId }, 400, requestId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    safeLog("error", "request_failed", {
      requestId,
      action,
      tenantId: auth.tenantId,
      message,
    });
    if (message.startsWith("SUPPRESSED:")) {
      return json({
        error: "Communication suppressed",
        reason_code: message.slice(11),
        requestId,
      }, 403, requestId);
    }
    const status = message === "FORBIDDEN" ? 403 : 500;
    return json({ error: message, requestId }, status, requestId);
  }
});
