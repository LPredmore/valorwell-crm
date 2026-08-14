import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const RESEND_API = "https://api.resend.com";
const USER_AGENT = "ValorWell-CRM-Provider-Applicant-Worker/1.0";

type Db = ReturnType<typeof createClient>;

interface ProviderApplicantJob {
  id: string;
  tenant_id: string;
  applicant_id: string;
  communication_kind: "initial_email" | "initial_sms";
  channel: "email" | "sms";
  content_version: string;
  scheduled_for: string;
  attempt_count: number;
  max_attempts: number;
  claim_token: string;
  email_message_id: string | null;
  provider_message_id: string | null;
  sent_at: string | null;
}

interface ProviderApplicantData {
  id: string;
  tenant_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  status: string;
}

interface ResendSettings {
  from_name: string | null;
  from_email: string | null;
  reply_to_email: string | null;
  inbound_email: string | null;
  connection_status: string;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "content-type": "application/json" },
});
const normalizeEmail = (value: string) => value.trim().toLowerCase();

function normalizePhone(phone: string | null): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("1") && digits.length === 11) digits = digits.slice(1);
  return digits.length === 10 ? `+1${digits}` : null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function resendSettings(db: Db, tenantId: string): Promise<ResendSettings> {
  const { data, error } = await db.from("crm_resend_email_settings")
    .select("from_name, from_email, reply_to_email, inbound_email, connection_status")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.from_email || data.connection_status !== "connected") {
    throw new Error("Resend email settings are not connected for this tenant");
  }
  return data as ResendSettings;
}

function displayFrom(settings: ResendSettings) {
  const email = normalizeEmail(settings.from_email ?? "");
  const name = String(settings.from_name ?? "").replace(/[<>\r\n]/g, "").trim();
  return name ? `${name} <${email}>` : email;
}

function taggedReplyTo(settings: ResendSettings, messageId: string): string | undefined {
  const email = normalizeEmail(settings.inbound_email || settings.reply_to_email || "");
  const [local, domain] = email.split("@");
  return local && domain ? `${local.split("+")[0]}+crm-${messageId}@${domain}` : email || undefined;
}

async function getRingCentralToken(): Promise<string> {
  const clientId = Deno.env.get("RINGCENTRAL_CLIENT_ID");
  const clientSecret = Deno.env.get("RINGCENTRAL_CLIENT_SECRET");
  const jwtToken = Deno.env.get("RINGCENTRAL_JWT_TOKEN");
  const serverUrl = Deno.env.get("RINGCENTRAL_SERVER_URL") || "https://platform.ringcentral.com";
  if (!clientId || !clientSecret || !jwtToken) throw new Error("Missing RingCentral credentials");
  const response = await fetch(`${serverUrl}/restapi/oauth/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwtToken }),
  });
  if (!response.ok) throw new Error(`RingCentral auth failed: ${response.status}`);
  return (await response.json()).access_token;
}

async function sendSms(token: string, phone: string, text: string): Promise<string | null> {
  const serverUrl = Deno.env.get("RINGCENTRAL_SERVER_URL") || "https://platform.ringcentral.com";
  const fromNumber = Deno.env.get("RINGCENTRAL_FROM_NUMBER");
  if (!fromNumber) throw new Error("Missing RingCentral sender number");
  const response = await fetch(`${serverUrl}/restapi/v1.0/account/~/extension/~/sms`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ from: { phoneNumber: fromNumber }, to: [{ phoneNumber: phone }], text }),
  });
  const responseText = await response.text();
  if (!response.ok) throw new Error(`RingCentral send failed: ${response.status}`);
  try {
    const payload = JSON.parse(responseText) as { id?: string | number };
    return payload.id === undefined ? null : String(payload.id);
  } catch {
    return null;
  }
}

export function providerApplicantEmailContent(applicant: ProviderApplicantData) {
  const firstName = applicant.first_name.trim() || "there";
  const escapedFirstName = escapeHtml(firstName);
  const subject = "Thank you for Applying to ValorWell";
  const html = [
    `<p>${escapedFirstName},</p>`,
    "<p>Thank you for applying to ValorWell. I wanted to reach out to you personally.</p>",
    "<p>One of the most important parts of ValorWell is our community. We are dedicated to ensuring that we put the right people in place to meet the needs of our clients.</p>",
    '<p>Please take a minute to review <a target="_blank" rel="noopener noreferrer" href="https://youtu.be/BoB2GSy0NQk">this video</a> about how ValorWell operates.</p>',
    '<p>If you feel this would be a good fit for you, please use this link to schedule a 30–60 minute call where I can learn more about you and answer any questions you have:</p>',
    '<p><a target="_blank" rel="noopener noreferrer" href="https://calendly.com/valorwell/1hr">https://calendly.com/valorwell/1hr</a></p>',
  ].join("");
  const text = `${firstName},\n\nThank you for applying to ValorWell. I wanted to reach out to you personally.\n\nOne of the most important parts of ValorWell is our community. We are dedicated to ensuring that we put the right people in place to meet the needs of our clients.\n\nPlease take a minute to review this video about how ValorWell operates: https://youtu.be/BoB2GSy0NQk\n\nIf you feel this would be a good fit for you, please use this link to schedule a 30–60 minute call where I can learn more about you and answer any questions you have:\n\nhttps://calendly.com/valorwell/1hr`;
  return { subject, html, text };
}

export function providerApplicantSmsContent(applicant: ProviderApplicantData): string {
  const firstName = applicant.first_name.trim() || "there";
  return `Hi, ${firstName}, this is Luke with ValorWell. I got your application and I just sent you an email. Check it out and get back to me if you have any questions.\n\nThis goes straight to my cell.`;
}

async function attachApplicantEmailMessage(db: Db, job: ProviderApplicantJob, emailMessageId: string) {
  const { error } = await db.rpc("crm_attach_provider_applicant_email_message", {
    p_job_id: job.id,
    p_claim_token: job.claim_token,
    p_email_message_id: emailMessageId,
  });
  if (error) throw new Error(error.message);
}

async function recordApplicantTransportAcceptance(
  db: Db,
  job: ProviderApplicantJob,
  providerMessageId: string | null,
  emailMessageId: string | null,
) {
  const { error } = await db.rpc("crm_record_provider_applicant_transport_acceptance", {
    p_job_id: job.id,
    p_claim_token: job.claim_token,
    p_provider_message_id: providerMessageId,
    p_email_message_id: emailMessageId,
  });
  if (error) throw new Error(error.message);
}

async function sendProviderApplicantEmail(
  db: Db,
  job: ProviderApplicantJob,
  applicant: ProviderApplicantData,
): Promise<{ emailMessageId: string; providerMessageId: string }> {
  const settings = await resendSettings(db, job.tenant_id);
  const content = providerApplicantEmailContent(applicant);
  const now = new Date().toISOString();
  let emailMessageId = job.email_message_id;

  if (emailMessageId) {
    const { data: existing, error } = await db.from("crm_email_messages")
      .select("id, status, provider_message_id")
      .eq("tenant_id", job.tenant_id)
      .eq("id", emailMessageId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (existing?.provider_message_id && ["sent", "delivered", "delivery_delayed"].includes(existing.status)) {
      await recordApplicantTransportAcceptance(db, job, existing.provider_message_id, existing.id);
      return { emailMessageId: existing.id, providerMessageId: existing.provider_message_id };
    }
    if (!existing) emailMessageId = null;
    else {
      const { error: resetError } = await db.from("crm_email_messages").update({
        status: "queued",
        failed_at: null,
        error_code: null,
        error_message: null,
        updated_at: now,
      }).eq("id", existing.id).eq("tenant_id", job.tenant_id);
      if (resetError) throw new Error(resetError.message);
    }
  }

  if (!emailMessageId) {
    const { data: message, error } = await db.from("crm_email_messages").insert({
      tenant_id: job.tenant_id,
      client_id: null,
      provider_applicant_id: applicant.id,
      campaign_id: null,
      direction: "outbound",
      status: "queued",
      sender_email: normalizeEmail(settings.from_email ?? ""),
      recipient_email: normalizeEmail(applicant.email),
      reply_to_email: settings.reply_to_email ? normalizeEmail(settings.reply_to_email) : null,
      subject: content.subject,
      body_html: content.html,
      body_text: content.text,
      provider: "resend",
      message_class: "necessary_recruiting",
      source: "provider_applicant_workflow",
      created_by_profile_id: null,
      occurred_at: now,
      metadata: {
        provider_applicant_job_id: job.id,
        content_version: job.content_version,
      },
    }).select("id").single();
    if (error || !message) throw new Error(error?.message ?? "Email log creation failed");
    emailMessageId = message.id;
    await attachApplicantEmailMessage(db, job, emailMessageId);
  }

  const apiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  if (!apiKey) throw new Error("RESEND_API_KEY not configured");

  let response: Response;
  try {
    response = await fetch(`${RESEND_API}/emails`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "user-agent": USER_AGENT,
        "idempotency-key": `provider-applicant/${job.id}`,
      },
      body: JSON.stringify({
        from: displayFrom(settings),
        to: [normalizeEmail(applicant.email)],
        reply_to: taggedReplyTo(settings, emailMessageId),
        subject: content.subject,
        html: content.html,
        text: content.text,
        headers: { "X-CRM-Email-Message-ID": emailMessageId },
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.from("crm_email_messages").update({
      status: "failed",
      failed_at: new Date().toISOString(),
      error_code: "network_error",
      error_message: message,
      updated_at: new Date().toISOString(),
    }).eq("id", emailMessageId);
    throw error;
  }

  const provider = await response.json().catch(() => ({})) as { id?: string; message?: string; name?: string };
  if (!response.ok || !provider.id) {
    await db.from("crm_email_messages").update({
      status: "failed",
      failed_at: new Date().toISOString(),
      error_code: provider.name ?? `http_${response.status}`,
      error_message: provider.message ?? "Resend rejected provider applicant email",
      updated_at: new Date().toISOString(),
    }).eq("id", emailMessageId);
    throw new Error(provider.message ?? `Resend send failed: ${response.status}`);
  }

  const sentAt = new Date().toISOString();
  const { error: updateError } = await db.from("crm_email_messages").update({
    status: "sent",
    provider_message_id: provider.id,
    sent_at: sentAt,
    updated_at: sentAt,
  }).eq("id", emailMessageId);
  if (updateError) throw new Error(updateError.message);

  await recordApplicantTransportAcceptance(db, job, provider.id, emailMessageId);
  return { emailMessageId, providerMessageId: provider.id };
}

async function completeApplicantJob(
  db: Db,
  job: ProviderApplicantJob,
  input: {
    status: "sent" | "failed" | "skipped" | "cancelled";
    providerMessageId?: string | null;
    emailMessageId?: string | null;
    errorCode?: string | null;
    errorDetail?: string | null;
    retryAt?: string | null;
  },
) {
  const { error } = await db.rpc("crm_complete_provider_applicant_communication_job", {
    p_job_id: job.id,
    p_claim_token: job.claim_token,
    p_status: input.status,
    p_provider_message_id: input.providerMessageId ?? null,
    p_email_message_id: input.emailMessageId ?? null,
    p_error_code: input.errorCode ?? null,
    p_error_detail: input.errorDetail ?? null,
    p_retry_at: input.retryAt ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function processProviderApplicantMessages(limit = 25) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data: claimed, error: claimError } = await db.rpc(
    "crm_claim_provider_applicant_communication_jobs",
    { p_limit: limit },
  );
  if (claimError) throw new Error(claimError.message);

  let ringCentralToken: string | null = null;
  const result = { processed: 0, sent: 0, skipped: 0, failed: 0 };

  for (const job of (claimed ?? []) as ProviderApplicantJob[]) {
    try {
      const { data, error } = await db.from("provider_applicants")
        .select("id, tenant_id, first_name, last_name, email, phone, status")
        .eq("id", job.applicant_id)
        .eq("tenant_id", job.tenant_id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) {
        await completeApplicantJob(db, job, {
          status: "skipped",
          errorCode: "applicant_not_found",
          errorDetail: "Provider applicant no longer exists in the job tenant",
        });
        result.skipped++;
        continue;
      }

      const applicant = data as ProviderApplicantData;
      const terminal = ["hired", "declined", "withdrawn", "inactive", "no_response"].includes(applicant.status);
      if (terminal && !job.sent_at) {
        await completeApplicantJob(db, job, {
          status: "cancelled",
          errorCode: "applicant_closed",
          errorDetail: "Applicant entered a terminal state before delivery",
        });
        result.skipped++;
        continue;
      }
      if (job.content_version !== "provider_recruiting_v1") {
        await completeApplicantJob(db, job, {
          status: "skipped",
          errorCode: "unsupported_content_version",
          errorDetail: `Unsupported provider applicant content version: ${job.content_version}`,
        });
        result.skipped++;
        continue;
      }

      let providerMessageId = job.provider_message_id;
      let emailMessageId = job.email_message_id;
      if (!job.sent_at) {
        if (job.channel === "email") {
          if (!applicant.email?.trim()) {
            await completeApplicantJob(db, job, {
              status: "skipped",
              errorCode: "missing_email",
              errorDetail: "Provider applicant does not have an email address",
            });
            result.skipped++;
            continue;
          }
          const sent = await sendProviderApplicantEmail(db, job, applicant);
          providerMessageId = sent.providerMessageId;
          emailMessageId = sent.emailMessageId;
        } else {
          const phone = normalizePhone(applicant.phone);
          if (!phone) {
            await completeApplicantJob(db, job, {
              status: "skipped",
              errorCode: "missing_or_invalid_phone",
              errorDetail: "Provider applicant does not have a valid US phone number",
            });
            result.skipped++;
            continue;
          }
          ringCentralToken ||= await getRingCentralToken();
          providerMessageId = await sendSms(
            ringCentralToken,
            phone,
            providerApplicantSmsContent(applicant),
          );
          await recordApplicantTransportAcceptance(db, job, providerMessageId, null);
        }
      }

      const { error: workflowError } = await db.rpc(
        "staff_record_provider_applicant_contact_delivery",
        {
          p_applicant_id: applicant.id,
          p_channel: job.channel,
          p_job_id: job.id,
          p_sent_at: job.sent_at ?? new Date().toISOString(),
        },
      );
      if (workflowError) throw new Error(workflowError.message);

      await completeApplicantJob(db, job, {
        status: "sent",
        providerMessageId,
        emailMessageId,
      });
      result.processed++;
      result.sent++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryMinutes = Math.min(240, 15 * (2 ** Math.max(0, job.attempt_count - 1)));
      try {
        await completeApplicantJob(db, job, {
          status: "failed",
          errorCode: "delivery_failed",
          errorDetail: message,
          retryAt: job.attempt_count < job.max_attempts
            ? new Date(Date.now() + retryMinutes * 60_000).toISOString()
            : null,
        });
      } catch (completionError) {
        console.error("Provider applicant job completion failed:", job.id, completionError);
      }
      console.error("Provider applicant communication failed:", job.id, message);
      result.failed++;
    }
  }

  return result;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const expected = Deno.env.get("CRON_SECRET");
  if (!expected) return json({ error: "Worker secret not configured" }, 500);
  if (request.headers.get("X-Cron-Secret") !== expected) return json({ error: "Unauthorized" }, 401);
  try {
    const providerApplicants = await processProviderApplicantMessages();
    return json({ success: true, providerApplicants, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error("Provider applicant communication worker failed:", error);
    return json({ success: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
