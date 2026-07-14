import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  checkSuppression,
  type MessageClass,
} from "../_shared/suppression.ts";

declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const HELPSCOUT_API_BASE = "https://api.helpscout.net/v2";
let cachedToken: { token: string; expiresAt: number } | null = null;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }
  const appId = Deno.env.get("HELPSCOUT_APP_ID");
  const appSecret = Deno.env.get("HELPSCOUT_APP_SECRET");
  if (!appId || !appSecret) throw new Error("HelpScout credentials not configured");

  const response = await fetch(`${HELPSCOUT_API_BASE}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: appId,
      client_secret: appSecret,
    }),
  });
  if (!response.ok) {
    await response.text();
    throw new Error(`HelpScout authentication failed: ${response.status}`);
  }
  const data = await response.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
  };
  return cachedToken.token;
}

async function hsRequest(
  method: string,
  endpoint: string,
  body?: unknown,
): Promise<Response> {
  const token = await getAccessToken();
  return fetch(`${HELPSCOUT_API_BASE}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function authenticate(req: Request): Promise<{
  userId: string;
  tenantId: string;
  serviceDb: ReturnType<typeof createClient>;
}> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) throw new Error("UNAUTHORIZED");

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const userDb = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data, error } = await userDb.auth.getClaims(
    authHeader.slice("Bearer ".length),
  );
  const userId = data?.claims?.sub;
  if (error || !userId) throw new Error("UNAUTHORIZED");

  const serviceDb = createClient(supabaseUrl, serviceKey);
  const { data: membership, error: membershipError } = await serviceDb
    .from("tenant_memberships")
    .select("tenant_id")
    .eq("profile_id", userId)
    .maybeSingle();
  if (membershipError || !membership) throw new Error("FORBIDDEN");

  return { userId, tenantId: membership.tenant_id, serviceDb };
}

async function resolveClientByEmail(
  db: ReturnType<typeof createClient>,
  tenantId: string,
  email: string,
): Promise<{ id: string; tenant_id: string; email: string | null } | null> {
  const { data, error } = await db.rpc("find_clients_by_emails_insensitive", {
    p_tenant_id: tenantId,
    p_emails: [normalizeEmail(email)],
  });
  if (error) throw new Error(`Client lookup failed: ${error.message}`);
  const row = (data || [])[0];
  if (!row) return null;
  return { id: row.id, tenant_id: tenantId, email: row.email ?? email };
}

async function enforcePolicy(
  clientId: string,
  tenantId: string,
  messageClass: MessageClass,
  workflow: string,
  correlationId: string | null,
): Promise<void> {
  const decision = await checkSuppression(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    {
      tenantId,
      clientId,
      channel: "email",
      messageClass,
      workflow,
      correlationId,
    },
  );
  if (!decision.allowed) {
    throw new Error(`SUPPRESSED:${decision.reason_code}`);
  }
}

async function logSent(
  db: ReturnType<typeof createClient>,
  tenantId: string,
  clientId: string,
  userId: string | null,
  metadata: Record<string, unknown>,
): Promise<void> {
  const { error } = await db.from("crm_activity_events").insert({
    tenant_id: tenantId,
    client_id: clientId,
    event_type: "email_sent",
    created_by_profile_id: userId,
    metadata,
  });
  if (error) console.error("Failed to log email_sent:", error.message);
}

async function processBulkSend(bulkSendId: string): Promise<void> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(supabaseUrl, serviceKey);
  const mailboxId = Deno.env.get("HELPSCOUT_MAILBOX_ID");
  if (!mailboxId) throw new Error("HELPSCOUT_MAILBOX_ID not configured");

  const { data: log, error: logError } = await db
    .from("crm_bulk_send_logs")
    .select("*")
    .eq("id", bulkSendId)
    .single();
  if (logError || !log) throw new Error("Bulk send log not found");

  await db
    .from("crm_bulk_send_logs")
    .update({ status: "sending", heartbeat_at: new Date().toISOString() })
    .eq("id", bulkSendId);

  const recipientType = log.recipient_type || "client";
  let rows: Array<{
    recipientId: string;
    clientId: string | null;
    email: string | null;
    firstName: string;
    lastName: string;
  }> = [];
  let table: string;

  if (recipientType === "staff") {
    table = "crm_bulk_send_staff_recipients";
    const { data, error } = await db
      .from(table)
      .select(`
        id,
        staff:staff_id (
          id,
          prov_name_f,
          prov_name_l,
          profiles!inner (email)
        )
      `)
      .eq("bulk_send_id", bulkSendId)
      .eq("status", "pending");
    if (error) throw new Error(error.message);
    rows = (data || []).map((row: any) => ({
      recipientId: row.id,
      clientId: null,
      email: row.staff?.profiles?.email ?? null,
      firstName: row.staff?.prov_name_f ?? "",
      lastName: row.staff?.prov_name_l ?? "",
    }));
  } else {
    table = "crm_bulk_send_recipients";
    const { data, error } = await db
      .from(table)
      .select(`
        id,
        client:client_id (
          id, email, pat_name_f, pat_name_l, pat_name_preferred
        )
      `)
      .eq("bulk_send_id", bulkSendId)
      .eq("status", "pending");
    if (error) throw new Error(error.message);
    rows = (data || []).map((row: any) => ({
      recipientId: row.id,
      clientId: row.client?.id ?? null,
      email: row.client?.email ?? null,
      firstName: row.client?.pat_name_preferred || row.client?.pat_name_f || "",
      lastName: row.client?.pat_name_l || "",
    }));
  }

  let sent = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      if (!row.email) throw new Error("No email address");

      if (row.clientId) {
        await enforcePolicy(
          row.clientId,
          log.tenant_id,
          "ordinary_promotional",
          "helpscout_bulk_send",
          bulkSendId,
        );
      }

      const response = await hsRequest("POST", "/conversations", {
        subject: log.subject,
        customer: {
          email: row.email,
          firstName: row.firstName,
          lastName: row.lastName,
        },
        mailboxId: Number(mailboxId),
        type: "email",
        status: "pending",
        threads: [{
          type: "reply",
          customer: { email: row.email },
          text: log.body_html,
        }],
      });
      if (!response.ok && response.status !== 201) {
        await response.text();
        throw new Error(`HelpScout send failed: ${response.status}`);
      }
      const location =
        response.headers.get("Location") || response.headers.get("Resource-ID");
      const conversationId = location?.split("/").pop() || null;

      await db
        .from(table)
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", row.recipientId);
      sent++;

      if (row.clientId) {
        await logSent(db, log.tenant_id, row.clientId, null, {
          source: "bulk",
          bulk_send_id: bulkSendId,
          conversation_id: conversationId,
          subject: log.subject,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      await db
        .from(table)
        .update({
          status: "failed",
          error_message: message,
          sent_at: new Date().toISOString(),
        })
        .eq("id", row.recipientId);
      failed++;
    }

    if ((i + 1) % 5 === 0 || i === rows.length - 1) {
      await db
        .from("crm_bulk_send_logs")
        .update({
          sent_count: sent,
          failed_count: failed,
          heartbeat_at: new Date().toISOString(),
        })
        .eq("id", bulkSendId);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  await db
    .from("crm_bulk_send_logs")
    .update({
      status: failed === rows.length && rows.length > 0 ? "failed" : "completed",
      sent_count: sent,
      failed_count: failed,
      completed_at: new Date().toISOString(),
    })
    .eq("id", bulkSendId);
}

async function verifyHelpScoutWebhook(
  rawBody: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(rawBody),
  );
  const expected = btoa(String.fromCharCode(...new Uint8Array(signed)));
  return expected === signature;
}

async function handleWebhook(req: Request): Promise<Response> {
  const secret = Deno.env.get("HELPSCOUT_WEBHOOK_SECRET");
  if (!secret) return json({ error: "Webhook secret not configured" }, 500);

  const signature = req.headers.get("X-HelpScout-Signature");
  if (!signature) return json({ error: "Missing signature" }, 401);

  const rawBody = await req.text();
  if (!(await verifyHelpScoutWebhook(rawBody, signature, secret))) {
    return json({ error: "Invalid signature" }, 401);
  }

  const eventType = req.headers.get("X-HelpScout-Event") || "";
  if (!eventType.includes("customer.reply")) {
    return json({ received: true, ignored: true });
  }

  const payload = JSON.parse(rawBody);
  const email =
    payload.customer?.email ||
    payload.primaryCustomer?.email ||
    payload._embedded?.customer?.email ||
    payload.data?.customer?.email ||
    payload.data?.primaryCustomer?.email;
  if (!email) return json({ received: true, noEmail: true });

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: clients, error } = await db
    .from("clients")
    .select("id, tenant_id")
    .ilike("email", normalizeEmail(email));
  if (error) return json({ error: "Database error" }, 500);
  if (!clients?.length) return json({ received: true, noClient: true });

  let responded = 0;
  for (const client of clients) {
    await db.from("crm_activity_events").insert({
      tenant_id: client.tenant_id,
      client_id: client.id,
      event_type: "email_received",
      created_by_profile_id: null,
      metadata: { source: "webhook", helpscout_event: eventType },
    });

    const { data: active } = await db
      .from("crm_campaign_enrollments")
      .select("id")
      .eq("tenant_id", client.tenant_id)
      .eq("client_id", client.id)
      .eq("status", "active");
    if (active?.length) {
      await db
        .from("crm_campaign_enrollments")
        .update({
          status: "responded",
          paused_at: new Date().toISOString(),
          pause_reason: "email_response",
          updated_at: new Date().toISOString(),
        })
        .in("id", active.map((row: any) => row.id));
      responded += active.length;
    }
  }

  return json({ received: true, enrollmentsPaused: responded });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  if (action === "webhook") {
    try {
      return await handleWebhook(req);
    } catch (error) {
      console.error("HelpScout webhook failed:", error);
      return json({ error: "Webhook processing failed" }, 500);
    }
  }

  let auth: Awaited<ReturnType<typeof authenticate>>;
  try {
    auth = await authenticate(req);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Unauthorized" },
      error instanceof Error && error.message === "FORBIDDEN" ? 403 : 401,
    );
  }

  const mailboxId = Deno.env.get("HELPSCOUT_MAILBOX_ID");

  try {
    switch (action) {
      case "list-conversations": {
        const page = Math.max(Number(url.searchParams.get("page") || 1), 1);
        const status = url.searchParams.get("status") || "all";
        let endpoint = `/conversations?mailbox=${mailboxId}&page=${page}&embed=threads`;
        if (status !== "all") endpoint += `&status=${encodeURIComponent(status)}`;
        const response = await hsRequest("GET", endpoint);
        if (!response.ok) {
          await response.text();
          throw new Error(`HelpScout list failed: ${response.status}`);
        }
        const data = await response.json();
        const conversations = data._embedded?.conversations || [];
        const emails = Array.from(new Set(
          conversations
            .map((c: any) => c.primaryCustomer?.email)
            .filter(Boolean)
            .map(normalizeEmail),
        ));
        const { data: matched } = emails.length
          ? await auth.serviceDb.rpc("find_clients_by_emails_insensitive", {
              p_tenant_id: auth.tenantId,
              p_emails: emails,
            })
          : { data: [] };
        const byEmail = new Map(
          (matched || []).map((row: any) => [normalizeEmail(row.email), row.id]),
        );
        const filtered = conversations
          .filter((c: any) => byEmail.has(normalizeEmail(c.primaryCustomer?.email || "")))
          .map((c: any) => ({
            ...c,
            client_id: byEmail.get(normalizeEmail(c.primaryCustomer.email)),
          }));
        return json({ ...data, _embedded: { conversations: filtered } });
      }

      case "get-conversation": {
        const id = url.searchParams.get("id");
        if (!id) return json({ error: "Conversation ID required" }, 400);
        const response = await hsRequest("GET", `/conversations/${id}?embed=threads`);
        if (!response.ok) {
          await response.text();
          throw new Error(`HelpScout get failed: ${response.status}`);
        }
        const conversation = await response.json();
        const customerEmail = conversation?.primaryCustomer?.email;
        if (!customerEmail) {
          return json({ error: "Conversation customer could not be resolved" }, 403);
        }
        const client = await resolveClientByEmail(
          auth.serviceDb,
          auth.tenantId,
          customerEmail,
        );
        if (!client) {
          return json({ error: "Conversation is not associated with a client in your tenant" }, 403);
        }
        return json({ ...conversation, client_id: client.id });
      }

      case "reply": {
        const id = url.searchParams.get("id");
        if (!id) return json({ error: "Conversation ID required" }, 400);
        const body = await req.json();
        if (!body.text) return json({ error: "Text required" }, 400);

        const conversationResponse = await hsRequest(
          "GET",
          `/conversations/${id}?fields=primaryCustomer`,
        );
        if (!conversationResponse.ok) {
          await conversationResponse.text();
          throw new Error(`Conversation lookup failed: ${conversationResponse.status}`);
        }
        const conversation = await conversationResponse.json();
        const customer = conversation.primaryCustomer;
        if (!customer?.id || !customer?.email) {
          throw new Error("Could not resolve primary customer");
        }
        const client = await resolveClientByEmail(
          auth.serviceDb,
          auth.tenantId,
          customer.email,
        );
        if (!client) return json({ error: "Client not found in tenant" }, 403);

        const messageClass = (body.messageClass || "active_care") as MessageClass;
        await enforcePolicy(client.id, auth.tenantId, messageClass, "helpscout_reply", id);

        const response = await hsRequest("POST", `/conversations/${id}/reply`, {
          customer: { id: customer.id },
          text: body.text,
          status: body.status || "active",
        });
        if (!response.ok && response.status !== 201) {
          await response.text();
          throw new Error(`HelpScout reply failed: ${response.status}`);
        }
        await logSent(auth.serviceDb, auth.tenantId, client.id, auth.userId, {
          source: "reply",
          conversation_id: id,
          message_class: messageClass,
        });
        return json({ success: true, conversationId: id });
      }

      case "create-conversation": {
        const body = await req.json();
        if (!body.subject || !body.customerEmail || !body.text) {
          return json({ error: "Subject, customerEmail, and text are required" }, 400);
        }
        const client = await resolveClientByEmail(
          auth.serviceDb,
          auth.tenantId,
          body.customerEmail,
        );
        if (!client) return json({ error: "Recipient is not a client in tenant" }, 403);
        const messageClass =
          (body.messageClass || "ordinary_promotional") as MessageClass;
        await enforcePolicy(
          client.id,
          auth.tenantId,
          messageClass,
          "helpscout_create_conversation",
          null,
        );

        const response = await hsRequest("POST", "/conversations", {
          subject: body.subject,
          customer: {
            email: body.customerEmail,
            firstName: body.customerName?.split(" ")[0] || "",
            lastName: body.customerName?.split(" ").slice(1).join(" ") || "",
          },
          mailboxId: Number(mailboxId),
          type: "email",
          status: "pending",
          threads: [{
            type: "reply",
            customer: { email: body.customerEmail },
            text: body.text,
          }],
        });
        if (!response.ok && response.status !== 201) {
          await response.text();
          throw new Error(`HelpScout create failed: ${response.status}`);
        }
        const location =
          response.headers.get("Location") || response.headers.get("Resource-ID");
        const conversationId = location?.split("/").pop() || null;
        await logSent(auth.serviceDb, auth.tenantId, client.id, auth.userId, {
          source: "create-conversation",
          conversation_id: conversationId,
          subject: body.subject,
          message_class: messageClass,
        });
        return json({ success: true, conversationId });
      }

      case "bulk-send": {
        const bulkSendId = url.searchParams.get("bulkSendId");
        if (!bulkSendId) return json({ error: "bulkSendId required" }, 400);
        const { data: job } = await auth.serviceDb
          .from("crm_bulk_send_logs")
          .select("tenant_id")
          .eq("id", bulkSendId)
          .maybeSingle();
        if (!job) return json({ error: "Bulk send job not found" }, 404);
        if (job.tenant_id !== auth.tenantId) return json({ error: "Forbidden" }, 403);
        EdgeRuntime.waitUntil(processBulkSend(bulkSendId));
        return json({ started: true, bulkSendId });
      }

      case "search-customers": {
        const email = url.searchParams.get("email");
        if (!email) return json({ error: "Email required" }, 400);
        const client = await resolveClientByEmail(
          auth.serviceDb,
          auth.tenantId,
          email,
        );
        if (!client) return json({ error: "Email not in tenant" }, 403);
        const response = await hsRequest(
          "GET",
          `/customers?email=${encodeURIComponent(email)}`,
        );
        if (!response.ok) {
          await response.text();
          throw new Error(`HelpScout search failed: ${response.status}`);
        }
        return json(await response.json());
      }

      case "test-connection": {
        const response = await hsRequest("GET", `/mailboxes/${mailboxId}`);
        if (!response.ok) {
          await response.text();
          throw new Error("Connection test failed");
        }
        const mailbox = await response.json();
        return json({
          connected: true,
          mailboxName: mailbox.name,
          mailboxEmail: mailbox.email,
        });
      }

      default:
        return json({ error: "Invalid action" }, 400);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    if (message.startsWith("SUPPRESSED:")) {
      return json({ error: "Communication suppressed", reason_code: message.slice(11) }, 403);
    }
    console.error("HelpScout proxy failed:", error);
    return json({ error: message }, 500);
  }
});
