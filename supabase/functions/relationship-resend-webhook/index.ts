import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "npm:resend@6.0.2";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

const firstAddress = (value: unknown): string => {
  if (Array.isArray(value)) return String(value[0] ?? "");
  return String(value ?? "").split(",")[0]?.trim() ?? "";
};

const headerValue = (headers: unknown, name: string): string | undefined => {
  if (Array.isArray(headers)) {
    const row = headers.find((item) =>
      typeof item === "object" && item !== null &&
      String((item as Record<string, unknown>).name ?? "").toLowerCase() === name.toLowerCase()
    );
    return row && typeof row === "object"
      ? String((row as Record<string, unknown>).value ?? "") || undefined
      : undefined;
  }
  if (typeof headers === "object" && headers !== null) {
    const entry = Object.entries(headers as Record<string, unknown>)
      .find(([key]) => key.toLowerCase() === name.toLowerCase());
    return entry ? String(entry[1] ?? "") || undefined : undefined;
  }
  return undefined;
};

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const webhookSecret = Deno.env.get("RESEND_RELATIONSHIP_WEBHOOK_SECRET") ?? "";
  const resendApiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!webhookSecret || !resendApiKey || !supabaseUrl || !serviceRoleKey) {
    return json({ error: "Relationship webhook runtime is not configured." }, 503);
  }

  const rawBody = await request.text();
  const svixId = request.headers.get("svix-id") ?? "";
  const svixTimestamp = request.headers.get("svix-timestamp") ?? "";
  const svixSignature = request.headers.get("svix-signature") ?? "";
  const resend = new Resend(resendApiKey);

  let event: Record<string, unknown>;
  try {
    event = resend.webhooks.verify({
      payload: rawBody,
      headers: { id: svixId, timestamp: svixTimestamp, signature: svixSignature },
      webhookSecret,
    }) as unknown as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid webhook signature." }, 401);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const eventType = String(event.type ?? "");
  const data = (typeof event.data === "object" && event.data !== null ? event.data : {}) as Record<string, unknown>;
  const occurredAt = String(event.created_at ?? new Date().toISOString());

  if (eventType === "email.received") {
    const emailId = String(data.email_id ?? data.id ?? "");
    if (!emailId) return json({ error: "Inbound email ID is missing." }, 400);

    const contentResponse = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
      headers: { authorization: `Bearer ${resendApiKey}` },
    });
    const content = await contentResponse.json().catch(() => ({})) as Record<string, unknown>;
    if (!contentResponse.ok) return json({ error: "Inbound email content could not be retrieved." }, 502);

    const headers = content.headers;
    const communicationHint = headerValue(headers, "x-relationship-communication-id");
    const inReplyTo = headerValue(headers, "in-reply-to");
    const { data: result, error } = await admin.rpc("ingest_relationship_inbound_reply", {
      p_provider: "resend",
      p_provider_event_id: svixId,
      p_provider_message_id: emailId,
      p_provider_thread_id: String(content.message_id ?? data.message_id ?? "") || null,
      p_outbound_communication_id: communicationHint || null,
      p_in_reply_to_provider_message_id: inReplyTo || null,
      p_from_email: firstAddress(content.from ?? data.from),
      p_to_email: firstAddress(content.to ?? data.to),
      p_subject: String(content.subject ?? data.subject ?? "") || null,
      p_body: String(content.text ?? content.html ?? ""),
      p_occurred_at: occurredAt,
      p_payload: event,
    });
    if (error) return json({ error: error.message }, 500);
    return json(result);
  }

  const providerMessageId = String(data.email_id ?? data.id ?? "");
  if (!providerMessageId) return json({ ignored: true, reason: "Provider message ID missing." });
  const { data: result, error } = await admin.rpc("ingest_relationship_provider_event", {
    p_provider: "resend",
    p_provider_event_id: svixId,
    p_event_type: eventType,
    p_provider_message_id: providerMessageId,
    p_occurred_at: occurredAt,
    p_payload: event,
  });
  if (error) return json({ error: error.message }, 500);
  return json(result);
});
