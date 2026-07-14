import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkSuppression } from "../_shared/suppression.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizePhone(phone: string | null): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("1") && digits.length === 11) digits = digits.slice(1);
  return digits.length === 10 ? `+1${digits}` : null;
}

function personalize(content: string, client: ClientData): string {
  const firstName = client.pat_name_preferred || client.pat_name_f || "there";
  let therapist = "your therapist";
  if (client.primary_staff) {
    therapist =
      client.primary_staff.prov_name_for_clients ||
      [client.primary_staff.prov_name_f, client.primary_staff.prov_name_l]
        .filter(Boolean)
        .join(" ") ||
      therapist;
  }
  return content
    .replace(/\{\{first_name\}\}/gi, firstName)
    .replace(/\{\{therapist_name\}\}/gi, therapist);
}

function parseTime(value: string): number | null {
  const [h, m] = value.split(":").map(Number);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return null;
  return h * 60 + m;
}

function isValidSendTime(timeZone: string, campaign: Campaign): boolean {
  try {
    const now = new Date();
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
    }).format(now);
    if (campaign.weekdays_only && (weekday === "Sat" || weekday === "Sun")) {
      return false;
    }

    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(now);
    const hour = Number(parts.find((p) => p.type === "hour")?.value);
    const minute = Number(parts.find((p) => p.type === "minute")?.value);
    const start = parseTime(campaign.send_window_start);
    const end = parseTime(campaign.send_window_end);
    if (!Number.isFinite(hour) || !Number.isFinite(minute) || start === null || end === null) {
      return false;
    }
    const current = hour * 60 + minute;
    return current >= start && current <= end;
  } catch (error) {
    console.error("Send-window evaluation failed:", error);
    return false;
  }
}

async function getRingCentralToken(): Promise<string> {
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
    throw new Error(`RingCentral auth failed: ${response.status}`);
  }
  return (await response.json()).access_token;
}

async function sendSms(token: string, phone: string, text: string): Promise<void> {
  const serverUrl =
    Deno.env.get("RINGCENTRAL_SERVER_URL") || "https://platform.ringcentral.com";
  const fromNumber = Deno.env.get("RINGCENTRAL_FROM_NUMBER");
  if (!fromNumber) throw new Error("Missing RingCentral sender number");
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
        to: [{ phoneNumber: phone }],
        text,
      }),
    },
  );
  if (!response.ok) {
    await response.text();
    throw new Error(`RingCentral send failed: ${response.status}`);
  }
  await response.text();
}

async function getHelpScoutToken(): Promise<string> {
  const appId = Deno.env.get("HELPSCOUT_APP_ID");
  const secret = Deno.env.get("HELPSCOUT_APP_SECRET");
  if (!appId || !secret) throw new Error("HelpScout credentials not configured");
  const response = await fetch("https://api.helpscout.net/v2/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: appId,
      client_secret: secret,
    }),
  });
  if (!response.ok) {
    await response.text();
    throw new Error(`HelpScout auth failed: ${response.status}`);
  }
  return (await response.json()).access_token;
}

async function sendEmail(
  token: string,
  mailboxId: string,
  client: ClientData,
  subject: string,
  body: string,
): Promise<string | null> {
  if (!client.email) throw new Error("Missing client email");
  const response = await fetch("https://api.helpscout.net/v2/conversations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      subject,
      customer: {
        email: client.email,
        firstName: client.pat_name_preferred || client.pat_name_f || "",
        lastName: client.pat_name_l || "",
      },
      mailboxId: Number(mailboxId),
      type: "email",
      status: "pending",
      threads: [{
        type: "reply",
        customer: { email: client.email },
        text: body,
      }],
    }),
  });
  if (!response.ok && response.status !== 201) {
    await response.text();
    throw new Error(`HelpScout send failed: ${response.status}`);
  }
  const location =
    response.headers.get("Location") || response.headers.get("Resource-ID");
  return location?.split("/").pop() || null;
}

async function releaseClaim(
  db: ReturnType<typeof createClient>,
  step: ClaimedStep,
  status: "scheduled" | "failed" | "skipped" | "suppressed" | "cancelled",
  reason?: string,
  nextAt?: Date,
): Promise<void> {
  const { error } = await db.rpc("release_campaign_step_claim", {
    p_step_log_id: step.id,
    p_claim_token: step.claim_token,
    p_status: status,
    p_reason: reason ?? null,
    p_next_scheduled_for: nextAt?.toISOString() ?? null,
  });
  if (error) console.error("Claim release failed:", step.id, error.message);
}

async function markSent(
  db: ReturnType<typeof createClient>,
  step: ClaimedStep,
  extra: Record<string, unknown> = {},
): Promise<boolean> {
  const { data, error } = await db
    .from("crm_campaign_step_logs")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      claimed_at: null,
      claim_token: null,
      updated_at: new Date().toISOString(),
      ...extra,
    })
    .eq("id", step.id)
    .eq("status", "processing")
    .eq("claim_token", step.claim_token)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return !!data;
}

async function scheduleNext(
  db: ReturnType<typeof createClient>,
  enrollment: any,
  currentStep: CampaignStep,
  campaign: Campaign,
  tenantId: string,
): Promise<void> {
  const { data: steps, error } = await db
    .from("crm_campaign_steps")
    .select("*")
    .eq("campaign_id", enrollment.campaign_id)
    .eq("is_active", true)
    .order("step_order", { ascending: true });
  if (error) throw new Error(error.message);

  const index = (steps || []).findIndex((s: any) => s.id === currentStep.id);
  const next = (steps || [])[index + 1] as CampaignStep | undefined;

  if (!next) {
    await db
      .from("crm_campaign_enrollments")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        current_step: currentStep.step_order,
        updated_at: new Date().toISOString(),
      })
      .eq("id", enrollment.id);

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

  await db
    .from("crm_campaign_enrollments")
    .update({
      current_step: currentStep.step_order,
      updated_at: new Date().toISOString(),
    })
    .eq("id", enrollment.id);
}

async function processCampaignMessages() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(supabaseUrl, serviceRoleKey);
  const mailboxId = Deno.env.get("HELPSCOUT_MAILBOX_ID");

  const { data: claimed, error: claimError } = await db.rpc(
    "claim_pending_campaign_steps",
    { p_limit: 50 },
  );
  if (claimError) throw new Error(claimError.message);

  let rcToken: string | null = null;
  let hsToken: string | null = null;
  const result = { processed: 0, sent: 0, skipped: 0, suppressed: 0, failed: 0 };

  for (const step of (claimed || []) as ClaimedStep[]) {
    try {
      const { data: enrollment, error: enrollmentError } = await db
        .from("crm_campaign_enrollments")
        .select(`
          id, campaign_id, client_id, current_step, status,
          campaign:crm_campaigns (
            id, name, is_active, weekdays_only,
            send_window_start, send_window_end, default_timezone,
            on_complete_action, on_complete_status
          )
        `)
        .eq("id", step.enrollment_id)
        .single();

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

      const { data: client, error: clientError } = await db
        .from("clients")
        .select(`
          id, email, phone, pat_name_f, pat_name_l, pat_name_preferred, pat_time_zone,
          primary_staff:staff!clients_primary_staff_id_fkey (
            prov_name_f, prov_name_l, prov_name_for_clients
          )
        `)
        .eq("id", step.client_id)
        .single();
      if (clientError || !client) {
        await releaseClaim(db, step, "skipped", "client_not_found");
        result.skipped++;
        continue;
      }

      const typedClient = client as unknown as ClientData;
      const timeZone =
        typedClient.pat_time_zone || campaign.default_timezone || "America/Chicago";
      if (!isValidSendTime(timeZone, campaign)) {
        await releaseClaim(
          db,
          step,
          "scheduled",
          "outside_send_window",
          new Date(Date.now() + 15 * 60 * 1000),
        );
        continue;
      }

      const { data: stepData, error: stepError } = await db
        .from("crm_campaign_steps")
        .select("*")
        .eq("id", step.step_id)
        .single();
      if (stepError || !stepData) {
        await releaseClaim(db, step, "skipped", "step_not_found");
        result.skipped++;
        continue;
      }
      const typedStep = stepData as CampaignStep;
      if (!typedStep.is_active) {
        await releaseClaim(db, step, "skipped", "step_disabled");
        result.skipped++;
        continue;
      }

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
        await releaseClaim(
          db,
          step,
          "suppressed",
          `suppressed:${decision.reason_code}`,
        );
        result.suppressed++;
        continue;
      }

      if (step.channel === "email") {
        if (!typedClient.email) {
          await releaseClaim(db, step, "skipped", "missing_email");
          result.skipped++;
          continue;
        }
        if (!mailboxId) throw new Error("HELPSCOUT_MAILBOX_ID not configured");
        hsToken ||= await getHelpScoutToken();
        const subject = personalize(
          typedStep.email_subject || "Message from your care team",
          typedClient,
        );
        let body = personalize(typedStep.email_body_html || "", typedClient);

        if (typedStep.signature_id) {
          const { data: signature } = await db
            .from("crm_email_signatures")
            .select("signature_type, body_html, image_url")
            .eq("id", typedStep.signature_id)
            .maybeSingle();
          if (signature?.signature_type === "image" && signature.image_url) {
            body += `<br><br><img src="${signature.image_url}" alt="Signature">`;
          } else if (signature?.body_html) {
            body += `<br><br>${signature.body_html}`;
          }
        }

        const conversationId = await sendEmail(
          hsToken,
          mailboxId,
          typedClient,
          subject,
          body,
        );
        if (!(await markSent(db, step, {
          helpscout_conversation_id: conversationId,
        }))) {
          continue;
        }

        await db.from("crm_activity_events").insert({
          tenant_id: step.tenant_id,
          client_id: step.client_id,
          event_type: "email_sent",
          created_by_profile_id: null,
          metadata: {
            source: "campaign",
            campaign_id: campaign.id,
            step_id: typedStep.id,
            conversation_id: conversationId,
          },
        });
      } else {
        const phone = normalizePhone(typedClient.phone);
        if (!phone) {
          await releaseClaim(db, step, "skipped", "missing_phone");
          result.skipped++;
          continue;
        }
        rcToken ||= await getRingCentralToken();
        await sendSms(
          rcToken,
          phone,
          personalize(typedStep.sms_body_text || "", typedClient),
        );
        if (!(await markSent(db, step))) continue;

        await db.from("crm_activity_events").insert({
          tenant_id: step.tenant_id,
          client_id: step.client_id,
          event_type: "sms_sent",
          created_by_profile_id: null,
          metadata: {
            source: "campaign",
            campaign_id: campaign.id,
            step_id: typedStep.id,
          },
        });
      }

      await scheduleNext(db, enrollment, typedStep, campaign, step.tenant_id);
      result.processed++;
      result.sent++;
    } catch (error) {
      console.error("Campaign step failed:", step.id, error);
      await releaseClaim(
        db,
        step,
        "failed",
        error instanceof Error ? error.message : "unknown_error",
      );
      result.failed++;
    }
  }

  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const expected = Deno.env.get("CRON_SECRET");
  if (!expected) return json({ error: "Scheduler secret not configured" }, 500);
  if (req.headers.get("X-Cron-Secret") !== expected) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    const result = await processCampaignMessages();
    return json({ success: true, ...result, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error("Campaign scheduler failed:", error);
    return json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});
