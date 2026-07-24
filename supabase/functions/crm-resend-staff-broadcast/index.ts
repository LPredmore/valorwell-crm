import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  canonicalStaffContentFromLog,
  prepareStaffBroadcastDelivery,
  type StaffEmailVariableValues,
} from "./staff-email-content.ts";

const RESEND_API = "https://api.resend.com";
const USER_AGENT = "ValorWell-CRM-Staff-Broadcast/1.0";
const BATCH_SIZE = 25;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Db = ReturnType<typeof createClient>;
type AuthContext = { userId: string; tenantId: string; crmRole: string; db: Db };
type Settings = {
  from_name: string | null;
  from_email: string | null;
  reply_to_email: string | null;
  inbound_email: string | null;
  connection_status: string;
};
type StaffRecipient = {
  id: string;
  profileId: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
  role: string;
  status: string;
};

const json = (body: unknown, status = 200, requestId?: string) => new Response(JSON.stringify(body), {
  status,
  headers: {
    ...corsHeaders,
    "content-type": "application/json",
    ...(requestId ? { "x-request-id": requestId } : {}),
  },
});
const normalizeEmail = (value: string) => value.trim().toLowerCase();
const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));

async function authenticate(request: Request, requestedTenantId: string): Promise<AuthContext> {
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
  const { data: capability, error: capabilityError } = await db.from("crm_user_capabilities")
    .select("tenant_id, crm_role")
    .eq("profile_id", userId)
    .eq("tenant_id", requestedTenantId)
    .in("crm_role", ["crm_admin", "crm_operator"])
    .limit(1)
    .maybeSingle();
  if (capabilityError || !capability?.tenant_id) throw new Error("FORBIDDEN");
  return { userId, tenantId: capability.tenant_id, crmRole: capability.crm_role, db };
}

async function settingsFor(db: Db, tenantId: string): Promise<Settings> {
  const { data, error } = await db.from("crm_resend_email_settings")
    .select("from_name, from_email, reply_to_email, inbound_email, connection_status")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.from_email || data.connection_status !== "connected") {
    throw new Error("Verified Resend sender settings are required");
  }
  return data as Settings;
}

async function staffRecipient(db: Db, tenantId: string, staffId: string): Promise<StaffRecipient> {
  const { data: staff, error: staffError } = await db.from("staff")
    .select("id, profile_id, prov_name_f, prov_name_l, prov_name_for_clients, prov_status")
    .eq("tenant_id", tenantId)
    .eq("id", staffId)
    .maybeSingle();
  if (staffError || !staff) throw new Error("Staff recipient was not found in tenant");
  if (staff.prov_status === "Inactive") throw new Error("Staff recipient is inactive");

  const { data: profile, error: profileError } = await db.from("profiles")
    .select("email")
    .eq("id", staff.profile_id)
    .maybeSingle();
  if (profileError || !profile?.email || !isEmail(profile.email)) throw new Error("Staff recipient has no valid email address");

  const { data: roles } = await db.from("user_roles")
    .select("role")
    .eq("user_id", staff.profile_id);
  const roleValues = (roles ?? []).map((row: { role?: string }) => String(row.role ?? ""));
  const role = roleValues.includes("admin") ? "Admin"
    : roleValues.includes("clinician") ? "Clinician"
    : roleValues.includes("operations") ? "Operations"
    : "Staff";
  const firstName = staff.prov_name_f || "Staff member";
  const lastName = staff.prov_name_l || "";
  const displayName = staff.prov_name_for_clients || [firstName, lastName].filter(Boolean).join(" ") || "Staff member";
  return {
    id: staff.id,
    profileId: staff.profile_id,
    email: normalizeEmail(profile.email),
    firstName,
    lastName: lastName || "Staff member",
    displayName,
    role,
    status: staff.prov_status,
  };
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

async function createOrReuseMessage(
  db: Db,
  auth: AuthContext,
  settings: Settings,
  job: Record<string, any>,
  claim: Record<string, any>,
  recipient: StaffRecipient,
  prepared: Awaited<ReturnType<typeof prepareStaffBroadcastDelivery>>,
) {
  if (claim.email_message_id) {
    const { data } = await db.from("crm_email_messages")
      .select("*")
      .eq("tenant_id", auth.tenantId)
      .eq("id", claim.email_message_id)
      .maybeSingle();
    if (data && ["sent", "delivered", "delivery_delayed"].includes(data.status)) return data;
    if (data) {
      const { data: reset, error } = await db.from("crm_email_messages").update({
        status: "queued", error_code: null, error_message: null, failed_at: null, updated_at: new Date().toISOString(),
      }).eq("id", data.id).select("*").single();
      if (error) throw new Error(error.message);
      return reset;
    }
  }

  const { data: message, error } = await db.from("crm_email_messages").insert({
    tenant_id: auth.tenantId,
    client_id: null,
    bulk_send_id: job.id,
    direction: "outbound",
    status: "queued",
    sender_email: normalizeEmail(settings.from_email ?? ""),
    recipient_email: recipient.email,
    reply_to_email: settings.reply_to_email ? normalizeEmail(settings.reply_to_email) : null,
    subject: prepared.subject,
    body_html: prepared.html,
    body_text: prepared.text,
    preheader: prepared.preheader,
    render_hash: prepared.renderHash,
    provider: "resend",
    message_class: "transactional_account",
    source: "staff_broadcast",
    metadata: {
      email_content_mode: "newsletter",
      editor_schema_version: prepared.schemaVersion,
      theme_key: prepared.themeKey,
      staff_id: recipient.id,
      staff_profile_id: recipient.profileId,
      staff_lifecycle_status: recipient.status,
    },
    created_by_profile_id: auth.userId,
    occurred_at: new Date().toISOString(),
  }).select("*").single();
  if (error) throw new Error(`Email log creation failed: ${error.message}`);

  const { error: linkError } = await db.from("crm_bulk_send_staff_recipients").update({
    email_message_id: message.id,
  }).eq("id", claim.id).eq("claim_token", claim.claim_token);
  if (linkError) throw new Error(linkError.message);
  return message;
}

async function markMessageFailed(db: Db, messageId: string, code: string, message: string) {
  const now = new Date().toISOString();
  await db.from("crm_email_messages").update({
    status: "failed", failed_at: now, error_code: code, error_message: message, updated_at: now,
  }).eq("id", messageId);
}

async function deliver(
  db: Db,
  auth: AuthContext,
  settings: Settings,
  job: Record<string, any>,
  claim: Record<string, any>,
  recipient: StaffRecipient,
  prepared: Awaited<ReturnType<typeof prepareStaffBroadcastDelivery>>,
) {
  const message = await createOrReuseMessage(db, auth, settings, job, claim, recipient, prepared);
  if (["sent", "delivered", "delivery_delayed"].includes(message.status)) return message;
  const apiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  if (!apiKey) {
    await markMessageFailed(db, message.id, "provider_not_configured", "RESEND_API_KEY not configured");
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
        "idempotency-key": `crm-staff-broadcast/${job.id}/${claim.id}`,
      },
      body: JSON.stringify({
        from: displayFrom(settings),
        to: [recipient.email],
        reply_to: taggedReplyTo(settings, message.id),
        subject: prepared.subject,
        html: prepared.html,
        text: prepared.text,
        headers: { "X-CRM-Email-Message-ID": message.id },
      }),
    });
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    await markMessageFailed(db, message.id, "network_error", text);
    throw error;
  }

  const provider = await response.json().catch(() => ({})) as { id?: string; message?: string; name?: string };
  if (!response.ok || !provider.id) {
    const text = provider.message ?? "Resend rejected the delivery request";
    await markMessageFailed(db, message.id, provider.name ?? `http_${response.status}`, text);
    throw new Error(text);
  }

  const now = new Date().toISOString();
  const { data: sent, error } = await db.from("crm_email_messages").update({
    status: "sent", provider_message_id: provider.id, sent_at: now, updated_at: now,
  }).eq("id", message.id).select("*").single();
  if (error) throw new Error(error.message);
  return sent;
}

async function counts(db: Db, bulkSendId: string) {
  const { data, error } = await db.from("crm_bulk_send_staff_recipients")
    .select("status")
    .eq("bulk_send_id", bulkSendId);
  if (error) throw new Error(error.message);
  let sent = 0;
  let failed = 0;
  let remaining = 0;
  for (const row of data ?? []) {
    if (row.status === "sent") sent += 1;
    else if (row.status === "failed") failed += 1;
    else remaining += 1;
  }
  return { sent, failed, remaining };
}

async function processBroadcast(auth: AuthContext, bulkSendId: string) {
  const { data: job, error: jobError } = await auth.db.from("crm_bulk_send_logs")
    .select("*")
    .eq("id", bulkSendId)
    .eq("tenant_id", auth.tenantId)
    .eq("recipient_type", "staff")
    .maybeSingle();
  if (jobError || !job) throw new Error("Staff broadcast job not found");
  if (!job.editor_document || job.content_mode !== "newsletter") throw new Error("Canonical staff broadcast content is required");
  const content = canonicalStaffContentFromLog(job);
  const settings = await settingsFor(auth.db, auth.tenantId);

  await auth.db.from("crm_bulk_send_logs").update({
    status: "in_progress", heartbeat_at: new Date().toISOString(),
  }).eq("id", job.id).eq("tenant_id", auth.tenantId);

  const { data: claims, error: claimError } = await auth.db.rpc("crm_claim_bulk_staff_recipients", {
    p_tenant_id: auth.tenantId,
    p_bulk_send_id: job.id,
    p_limit: BATCH_SIZE,
  });
  if (claimError) throw new Error(claimError.message);

  let batchSent = 0;
  let batchFailed = 0;
  for (const claim of claims ?? []) {
    try {
      const recipient = await staffRecipient(auth.db, auth.tenantId, claim.staff_id);
      const values: StaffEmailVariableValues = {
        staff_first_name: recipient.firstName,
        staff_last_name: recipient.lastName,
        staff_display_name: recipient.displayName,
        staff_role: recipient.role,
        sender_name: settings.from_name || "ValorWell Operations",
      };
      const prepared = await prepareStaffBroadcastDelivery({
        subjectTemplate: job.subject,
        content,
        values,
      });
      await deliver(auth.db, auth, settings, job, claim, recipient, prepared);
      const { error } = await auth.db.from("crm_bulk_send_staff_recipients").update({
        status: "sent", sent_at: new Date().toISOString(), error_message: null,
        claim_token: null, claimed_at: null,
      }).eq("id", claim.id).eq("claim_token", claim.claim_token);
      if (error) throw new Error(error.message);
      batchSent += 1;
    } catch (error) {
      await auth.db.from("crm_bulk_send_staff_recipients").update({
        status: "failed", sent_at: new Date().toISOString(),
        error_message: error instanceof Error ? error.message : String(error),
        claim_token: null, claimed_at: null,
      }).eq("id", claim.id).eq("claim_token", claim.claim_token);
      batchFailed += 1;
    }
  }

  const current = await counts(auth.db, job.id);
  const complete = current.remaining === 0;
  await auth.db.from("crm_bulk_send_logs").update({
    status: complete ? (current.sent === 0 && current.failed > 0 ? "failed" : "completed") : "in_progress",
    sent_count: current.sent,
    failed_count: current.failed,
    heartbeat_at: new Date().toISOString(),
    completed_at: complete ? new Date().toISOString() : null,
  }).eq("id", job.id).eq("tenant_id", auth.tenantId);
  return { bulkSendId: job.id, batchSent, batchFailed, ...current, complete };
}

Deno.serve(async (request: Request) => {
  const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
  if (request.method === "OPTIONS") return new Response("ok", { headers: { ...corsHeaders, "x-request-id": requestId } });
  if (request.method !== "POST") return json({ error: "Method not allowed", requestId }, 405, requestId);

  let body: { tenantId?: string; bulkSendId?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body", requestId }, 400, requestId);
  }
  if (!body.tenantId || !body.bulkSendId) return json({ error: "tenantId and bulkSendId are required", requestId }, 400, requestId);

  let auth: AuthContext;
  try {
    auth = await authenticate(request, body.tenantId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNAUTHORIZED";
    return json({ error: message, requestId }, message === "FORBIDDEN" ? 403 : 401, requestId);
  }

  try {
    return json({ ...(await processBroadcast(auth, body.bulkSendId)), requestId }, 200, requestId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ component: "crm-resend-staff-broadcast", requestId, tenantId: auth.tenantId, message }));
    return json({ error: message, requestId }, message === "FORBIDDEN" ? 403 : 500, requestId);
  }
});
