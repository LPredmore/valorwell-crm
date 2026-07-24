import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkSuppression } from "../_shared/suppression.ts";
import {
  appendSignature,
  buildCampaignResendContent,
  prepareCampaignEmail,
  type ClientCampaignVariableValues,
  type PreparedCampaignEmail,
} from "./email-content.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const RESEND_API = "https://api.resend.com";
const USER_AGENT = "ValorWell-CRM-Campaign-Scheduler/1.1";

type Db = ReturnType<typeof createClient>;
interface ClaimedStep {
  id: string;
  enrollment_id: string;
  step_id: string;
  tenant_id: string;
  client_id: string;
  scheduled_for: string;
  channel: "email" | "sms";
  claim_token: string;
}
interface CampaignStep {
  id: string;
  campaign_id: string;
  step_order: number;
  delay_days: number;
  delay_hours: number;
  channel: "email" | "sms";
  email_subject: string | null;
  email_body_html: string | null;
  email_body_text: string | null;
  email_preheader: string | null;
  email_content_mode: string | null;
  email_editor_document: unknown;
  email_theme_key: string | null;
  email_editor_schema_version: number | null;
  email_render_hash: string | null;
  email_template_version_id: string | null;
  sms_body_text: string | null;
  is_active: boolean;
  signature_id: string | null;
}
interface Campaign {
  id: string;
  name: string;
  is_active: boolean;
  weekdays_only: boolean;
  send_window_start: string;
  send_window_end: string;
  default_timezone: string;
  on_complete_action: string | null;
  on_complete_status: string | null;
}
interface ClientData {
  id: string;
  email: string | null;
  phone: string | null;
  pat_name_f: string | null;
  pat_name_l: string | null;
  pat_name_preferred: string | null;
  pat_time_zone: string | null;
  primary_staff: {
    prov_name_f: string | null;
    prov_name_l: string | null;
    prov_name_for_clients: string | null;
  } | null;
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

function therapistName(client: ClientData): string {
  if (!client.primary_staff) return "ValorWell Care Team";
  return client.primary_staff.prov_name_for_clients
    || [client.primary_staff.prov_name_f, client.primary_staff.prov_name_l].filter(Boolean).join(" ")
    || "ValorWell Care Team";
}

function legacyPersonalize(content: string, client: ClientData): string {
  const firstName = client.pat_name_preferred || client.pat_name_f || "there";
  return content
    .replace(/\{\{first_name\}\}/gi, firstName)
    .replace(/\{\{preferred_name\}\}/gi, firstName)
    .replace(/\{\{last_name\}\}/gi, client.pat_name_l || "")
    .replace(/\{\{therapist_name\}\}/gi, therapistName(client));
}

function parseTime(value: string): number | null {
  const [hour, minute] = value.split(":").map(Number);
  return Number.isInteger(hour) && Number.isInteger(minute) ? hour * 60 + minute : null;
}

function isValidSendTime(timeZone: string, campaign: Campaign): boolean {
  try {
    const now = new Date();
    const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(now);
    if (campaign.weekdays_only && (weekday === "Sat" || weekday === "Sun")) return false;
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(now);
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    const start = parseTime(campaign.send_window_start);
    const end = parseTime(campaign.send_window_end);
    if (!Number.isFinite(hour) || !Number.isFinite(minute) || start === null || end === null) return false;
    const current = hour * 60 + minute;
    return current >= start && current <= end;
  } catch {
    return false;
  }
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

async function sendSms(token: string, phone: string, text: string) {
  const serverUrl = Deno.env.get("RINGCENTRAL_SERVER_URL") || "https://platform.ringcentral.com";
  const fromNumber = Deno.env.get("RINGCENTRAL_FROM_NUMBER");
  if (!fromNumber) throw new Error("Missing RingCentral sender number");
  const response = await fetch(`${serverUrl}/restapi/v1.0/account/~/extension/~/sms`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ from: { phoneNumber: fromNumber }, to: [{ phoneNumber: phone }], text }),
  });
  if (!response.ok) throw new Error(`RingCentral send failed: ${response.status}`);
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

async function validateTemplateVersion(db: Db, tenantId: string, versionId: string | null) {
  if (!versionId) return;
  const { data, error } = await db.from("crm_email_template_versions")
    .select("id, content_scope, content_mode")
    .eq("tenant_id", tenantId)
    .eq("id", versionId)
    .maybeSingle();
  if (error || !data) throw new Error("EMAIL_TEMPLATE_VERSION_NOT_FOUND");
  if (data.content_scope !== "client" || data.content_mode !== "campaign") {
    throw new Error("EMAIL_TEMPLATE_VERSION_SCOPE_INVALID");
  }
}

async function sendEmail(
  db: Db,
  tenantId: string,
  client: ClientData,
  campaignId: string,
  stepId: string,
  settings: ResendSettings,
  prepared: PreparedCampaignEmail,
): Promise<string> {
  if (!client.email) throw new Error("Missing client email");
  await validateTemplateVersion(db, tenantId, prepared.templateVersionId);
  const now = new Date().toISOString();
  const { data: message, error: insertError } = await db.from("crm_email_messages").insert({
    tenant_id: tenantId,
    client_id: client.id,
    campaign_id: campaignId,
    direction: "outbound",
    status: "queued",
    sender_email: normalizeEmail(settings.from_email ?? ""),
    recipient_email: normalizeEmail(client.email),
    reply_to_email: settings.reply_to_email ? normalizeEmail(settings.reply_to_email) : null,
    subject: prepared.subject,
    body_html: prepared.html,
    body_text: prepared.text || null,
    preheader: prepared.preheader,
    render_hash: prepared.renderHash,
    template_version_id: prepared.templateVersionId,
    provider: "resend",
    message_class: "ordinary_campaign_follow_up",
    source: "campaign_scheduler",
    created_by_profile_id: null,
    occurred_at: now,
    metadata: {
      campaign_step_id: stepId,
      email_content_mode: prepared.canonical ? "campaign" : null,
      editor_schema_version: prepared.schemaVersion,
      theme_key: prepared.themeKey,
    },
  }).select("id").single();
  if (insertError) throw new Error(insertError.message);

  const apiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  if (!apiKey) throw new Error("RESEND_API_KEY not configured");
  const response = await fetch(`${RESEND_API}/emails`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "user-agent": USER_AGENT,
      "idempotency-key": `crm-campaign/${message.id}`,
    },
    body: JSON.stringify({
      from: displayFrom(settings),
      to: [normalizeEmail(client.email)],
      reply_to: taggedReplyTo(settings, message.id),
      ...buildCampaignResendContent(prepared),
      headers: { "X-CRM-Email-Message-ID": message.id },
    }),
  });
  const provider = await response.json().catch(() => ({})) as { id?: string; message?: string; name?: string };
  if (!response.ok || !provider.id) {
    await db.from("crm_email_messages").update({
      status: "failed",
      failed_at: new Date().toISOString(),
      error_code: provider.name ?? `http_${response.status}`,
      error_message: provider.message ?? "Resend rejected campaign email",
      updated_at: new Date().toISOString(),
    }).eq("id", message.id);
    throw new Error(provider.message ?? `Resend send failed: ${response.status}`);
  }
  const sentAt = new Date().toISOString();
  await db.from("crm_email_messages").update({
    status: "sent",
    provider_message_id: provider.id,
    sent_at: sentAt,
    updated_at: sentAt,
  }).eq("id", message.id);
  return provider.id;
}

async function releaseClaim(
  db: Db,
  step: ClaimedStep,
  status: "scheduled" | "failed" | "skipped" | "suppressed" | "cancelled",
  reason?: string,
  nextAt?: Date,
) {
  const { error } = await db.rpc("release_campaign_step_claim", {
    p_step_log_id: step.id,
    p_claim_token: step.claim_token,
    p_status: status,
    p_reason: reason ?? null,
    p_next_scheduled_for: nextAt?.toISOString() ?? null,
  });
  if (error) console.error("Claim release failed:", step.id, error.message);
}

async function markSent(db: Db, step: ClaimedStep, extra: Record<string, unknown> = {}) {
  const { data, error } = await db.from("crm_campaign_step_logs").update({
    status: "sent",
    sent_at: new Date().toISOString(),
    claimed_at: null,
    claim_token: null,
    updated_at: new Date().toISOString(),
    ...extra,
  }).eq("id", step.id).eq("status", "processing").eq("claim_token", step.claim_token).select("id").maybeSingle();
  if (error) throw new Error(error.message);
  return !!data;
}

async function scheduleNext(db: Db, enrollment: any, currentStep: CampaignStep, campaign: Campaign, tenantId: string) {
  const { data: steps, error } = await db.from("crm_campaign_steps")
    .select("*")
    .eq("campaign_id", enrollment.campaign_id)
    .eq("is_active", true)
    .order("step_order", { ascending: true });
  if (error) throw new Error(error.message);
  const index = (steps ?? []).findIndex((row: any) => row.id === currentStep.id);
  const next = (steps ?? [])[index + 1] as CampaignStep | undefined;
  if (!next) {
    await db.from("crm_campaign_enrollments").update({
      status: "completed",
      completed_at: new Date().toISOString(),
      current_step: currentStep.step_order,
      updated_at: new Date().toISOString(),
    }).eq("id", enrollment.id);
    if (campaign.on_complete_action || campaign.on_complete_status) {
      await db.from("crm_activity_events").insert({
        tenant_id: tenantId,
        client_id: enrollment.client_id,
        event_type: "campaign_completion_state_action_deferred",
        created_by_profile_id: null,
        metadata: {
          campaign_id: campaign.id,
          requested_action: campaign.on_complete_action,
          requested_status: campaign.on_complete_status,
          reason: "legacy_pat_status_completion_action_retired",
        },
      });
    }
    return;
  }
  const nextAt = new Date();
  nextAt.setDate(nextAt.getDate() + (next.delay_days || 0));
  nextAt.setHours(nextAt.getHours() + (next.delay_hours || 0));
  const { error: insertError } = await db.from("crm_campaign_step_logs").insert({
    enrollment_id: enrollment.id,
    step_id: next.id,
    tenant_id: tenantId,
    client_id: enrollment.client_id,
    scheduled_for: nextAt.toISOString(),
    status: "scheduled",
    channel: next.channel,
    updated_at: new Date().toISOString(),
  });
  if (insertError && insertError.code !== "23505") throw new Error(insertError.message);
  await db.from("crm_campaign_enrollments").update({
    current_step: currentStep.step_order,
    updated_at: new Date().toISOString(),
  }).eq("id", enrollment.id);
}

async function processCampaignMessages() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data: claimed, error: claimError } = await db.rpc("claim_pending_campaign_steps", { p_limit: 50 });
  if (claimError) throw new Error(claimError.message);
  let rcToken: string | null = null;
  const result = { processed: 0, sent: 0, skipped: 0, suppressed: 0, failed: 0 };

  for (const step of (claimed ?? []) as ClaimedStep[]) {
    try {
      const { data: enrollment, error: enrollmentError } = await db.from("crm_campaign_enrollments").select(`
        id, campaign_id, client_id, current_step, status,
        campaign:crm_campaigns (
          id, name, is_active, weekdays_only, send_window_start, send_window_end,
          default_timezone, on_complete_action, on_complete_status
        )
      `).eq("id", step.enrollment_id).single();
      if (enrollmentError || !enrollment || enrollment.status !== "active") {
        await releaseClaim(db, step, "skipped", "enrollment_not_active");
        result.skipped++;
        continue;
      }
      const campaign = enrollment.campaign as unknown as Campaign;
      if (!campaign?.is_active) {
        await releaseClaim(db, step, "skipped", "campaign_inactive");
        result.skipped++;
        continue;
      }
      const { data: client, error: clientError } = await db.from("clients").select(`
        id, email, phone, pat_name_f, pat_name_l, pat_name_preferred, pat_time_zone,
        primary_staff:staff!clients_primary_staff_id_fkey (
          prov_name_f, prov_name_l, prov_name_for_clients
        )
      `).eq("id", step.client_id).single();
      if (clientError || !client) {
        await releaseClaim(db, step, "skipped", "client_not_found");
        result.skipped++;
        continue;
      }
      const typedClient = client as unknown as ClientData;
      const timeZone = typedClient.pat_time_zone || campaign.default_timezone || "America/Chicago";
      if (!isValidSendTime(timeZone, campaign)) {
        await releaseClaim(db, step, "scheduled", "outside_send_window", new Date(Date.now() + 15 * 60 * 1000));
        continue;
      }
      const { data: stepData, error: stepError } = await db.from("crm_campaign_steps").select("*").eq("id", step.step_id).single();
      if (stepError || !stepData || !stepData.is_active) {
        await releaseClaim(db, step, "skipped", stepData ? "step_disabled" : "step_not_found");
        result.skipped++;
        continue;
      }
      const typedStep = stepData as CampaignStep;
      const decision = await checkSuppression(supabaseUrl, serviceRoleKey, {
        tenantId: step.tenant_id,
        clientId: step.client_id,
        channel: step.channel,
        messageClass: "ordinary_campaign_follow_up",
        workflow: "campaign_scheduler",
        correlationId: step.id,
        campaignId: campaign.id,
        stepId: typedStep.id,
      });
      if (!decision.allowed) {
        await releaseClaim(db, step, "suppressed", `suppressed:${decision.reason_code}`);
        result.suppressed++;
        continue;
      }

      if (step.channel === "email") {
        if (!typedClient.email) {
          await releaseClaim(db, step, "skipped", "missing_email");
          result.skipped++;
          continue;
        }
        const settings = await resendSettings(db, step.tenant_id);
        const values: ClientCampaignVariableValues = {
          first_name: typedClient.pat_name_f || "Client",
          preferred_name: typedClient.pat_name_preferred || typedClient.pat_name_f || "Client",
          last_name: typedClient.pat_name_l || "Client",
          therapist_name: therapistName(typedClient),
          sender_name: settings.from_name || "ValorWell Care Team",
        };
        let prepared = await prepareCampaignEmail({
          step: {
            subjectTemplate: typedStep.email_subject || "Message from your care team",
            renderedHtml: typedStep.email_body_html || "",
            renderedText: typedStep.email_body_text,
            preheader: typedStep.email_preheader,
            contentMode: typedStep.email_content_mode,
            editorDocument: typedStep.email_editor_document,
            themeKey: typedStep.email_theme_key,
            schemaVersion: typedStep.email_editor_schema_version,
            renderHash: typedStep.email_render_hash,
            templateVersionId: typedStep.email_template_version_id,
          },
          values,
        });
        if (typedStep.signature_id) {
          const { data: signature } = await db.from("crm_email_signatures")
            .select("signature_type, body_html, body_text, image_url")
            .eq("tenant_id", step.tenant_id)
            .eq("id", typedStep.signature_id)
            .maybeSingle();
          if (signature?.signature_type === "image" && signature.image_url) {
            prepared = appendSignature(prepared, { imageUrl: signature.image_url, bodyText: signature.body_text });
          } else if (signature?.body_html || signature?.body_text) {
            prepared = appendSignature(prepared, { bodyHtml: signature.body_html, bodyText: signature.body_text });
          }
        }
        const resendId = await sendEmail(db, step.tenant_id, typedClient, campaign.id, typedStep.id, settings, prepared);
        if (!(await markSent(db, step, { resend_email_id: resendId }))) continue;
        await db.from("crm_activity_events").insert({
          tenant_id: step.tenant_id,
          client_id: step.client_id,
          event_type: "email_sent",
          created_by_profile_id: null,
          metadata: { source: "campaign", provider: "resend", campaign_id: campaign.id, step_id: typedStep.id, provider_message_id: resendId },
        });
      } else {
        const phone = normalizePhone(typedClient.phone);
        if (!phone) {
          await releaseClaim(db, step, "skipped", "missing_phone");
          result.skipped++;
          continue;
        }
        rcToken ||= await getRingCentralToken();
        await sendSms(rcToken, phone, legacyPersonalize(typedStep.sms_body_text || "", typedClient));
        if (!(await markSent(db, step))) continue;
        await db.from("crm_activity_events").insert({
          tenant_id: step.tenant_id,
          client_id: step.client_id,
          event_type: "sms_sent",
          created_by_profile_id: null,
          metadata: { source: "campaign", campaign_id: campaign.id, step_id: typedStep.id },
        });
      }
      await scheduleNext(db, enrollment, typedStep, campaign, step.tenant_id);
      result.processed++;
      result.sent++;
    } catch (error) {
      console.error("Campaign step failed:", step.id, error);
      await releaseClaim(db, step, "failed", error instanceof Error ? error.message : "unknown_error");
      result.failed++;
    }
  }
  return result;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const expected = Deno.env.get("CRON_SECRET");
  if (!expected) return json({ error: "Scheduler secret not configured" }, 500);
  if (request.headers.get("X-Cron-Secret") !== expected) return json({ error: "Unauthorized" }, 401);
  try {
    return json({ success: true, ...(await processCampaignMessages()), timestamp: new Date().toISOString() });
  } catch (error) {
    console.error("Campaign scheduler failed:", error);
    return json({ success: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
