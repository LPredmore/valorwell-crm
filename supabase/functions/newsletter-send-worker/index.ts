import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.93.1";
import {
  renderNewsletterDelivery,
  validateNewsletterTemplateContract,
  type RenderedNewsletterDelivery,
} from "./rendering.ts";

const RESEND_API = "https://api.resend.com";
const USER_AGENT = "ValorWell-CRM-Newsletter/1.0";
const DEFAULT_UNSUBSCRIBE_BASE = "https://crm.valorwell.org/newsletter/unsubscribe";

type ClaimedRecipient = {
  recipientId: string;
  emailMessageId: string;
  deliveryEmail: string;
  mailboxKey: string;
  greetingName: string;
  qualifyingAudiences: string[];
  unsubscribeToken: string;
  attempt: number;
};

type ClaimBatch = {
  newsletterId: string;
  claimToken: string;
  senderEmail: string;
  senderName: string | null;
  postalAddress: string | null;
  subject: string | null;
  recipients: ClaimedRecipient[];
};

type DueNewsletter = { newsletterId: string; tenantId: string; name: string };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function log(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}) {
  const payload = JSON.stringify({ component: "newsletter-send-worker", event, ...fields });
  if (level === "error") console.error(payload);
  else if (level === "warn") console.warn(payload);
  else console.log(payload);
}

async function sendOne(
  apiKey: string,
  batch: ClaimBatch,
  recipient: ClaimedRecipient,
  body: RenderedNewsletterDelivery,
  replyTo: string | null,
): Promise<{ providerMessageId: string } | { errorCode: string; errorMessage: string }> {
  let response: Response;
  try {
    response = await fetch(`${RESEND_API}/emails`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "user-agent": USER_AGENT,
        // one key per ledger record + attempt: retries never double-send
        "idempotency-key": `crm-newsletter/${recipient.emailMessageId}/${recipient.attempt}`,
      },
      body: JSON.stringify({
        from: displayFrom(batch.senderEmail, batch.senderName),
        to: [recipient.deliveryEmail],
        reply_to: replyTo ?? undefined,
        subject: body.subject,
        html: body.html,
        text: body.text,
        headers: {
          "List-Unsubscribe": `<${body.unsubscribeLink}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      }),
    });
  } catch (error) {
    return { errorCode: "network_error", errorMessage: error instanceof Error ? error.message : String(error) };
  }

  const provider = await response.json().catch(() => ({})) as { id?: string; message?: string; name?: string };
  if (!response.ok || !provider.id) {
    return {
      errorCode: provider.name ?? `http_${response.status}`,
      errorMessage: provider.message ?? "Resend rejected the newsletter delivery",
    };
  }
  return { providerMessageId: provider.id };
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  const apiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Worker runtime is not configured." }, 503);
  if (!apiKey) return json({ error: "RESEND_API_KEY is not configured." }, 503);

  const authorization = request.headers.get("authorization") ?? "";
  const providedCronSecret = request.headers.get("x-cron-secret") ?? "";
  const authorized = authorization === `Bearer ${serviceRoleKey}` ||
    (cronSecret.length > 0 && providedCronSecret === cronSecret);
  if (!authorized) return json({ error: "Newsletter send worker authorization is required." }, 403);

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const input = await request.json().catch(() => ({})) as {
    newsletterId?: string;
    batchSize?: number;
    maxBatches?: number;
  };
  const batchSize = Math.min(Math.max(Number(input.batchSize ?? 25), 1), 200);
  const maxBatches = Math.min(Math.max(Number(input.maxBatches ?? 4), 1), 20);

  const { data: released } = await admin.rpc("crm_release_stale_newsletter_claims", {
    p_older_than_minutes: 15,
  });

  let due: DueNewsletter[];
  if (input.newsletterId) {
    due = [{ newsletterId: String(input.newsletterId), tenantId: "", name: "" }];
  } else {
    const { data, error } = await admin.rpc("crm_claim_due_newsletters", { p_limit: 5 });
    if (error) return json({ error: error.message }, 500);
    due = ((data as { newsletters?: DueNewsletter[] } | null)?.newsletters ?? []);
  }

  const results: unknown[] = [];

  for (const newsletter of due) {
    // template body is read once per newsletter, not once per recipient
    const { data: letter, error: letterError } = await admin
      .from("crm_newsletters")
      .select("id, tenant_id, subject, preheader, body_html, body_text, status")
      .eq("id", newsletter.newsletterId)
      .maybeSingle();
    if (letterError || !letter) {
      results.push({ newsletterId: newsletter.newsletterId, outcome: "newsletter_unavailable" });
      continue;
    }

    const template = {
      subject: letter.subject as string | null,
      preheader: letter.preheader as string | null,
      html: letter.body_html as string | null,
      text: letter.body_text as string | null,
    };
    try {
      validateNewsletterTemplateContract(template);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log("error", "template_contract_invalid", { newsletterId: letter.id, message });
      results.push({ newsletterId: letter.id, outcome: "template_invalid", error: message });
      continue;
    }

    const { data: settings } = await admin
      .from("crm_resend_email_settings")
      .select("reply_to_email")
      .eq("tenant_id", letter.tenant_id)
      .maybeSingle();
    const replyTo = settings?.reply_to_email ? String(settings.reply_to_email) : null;

    let sent = 0;
    let failed = 0;
    let batches = 0;

    while (batches < maxBatches) {
      const { data: claimData, error: claimError } = await admin.rpc("crm_claim_newsletter_recipients", {
        p_newsletter_id: letter.id,
        p_limit: batchSize,
      });
      if (claimError) {
        log("error", "claim_failed", { newsletterId: letter.id, message: claimError.message });
        results.push({ newsletterId: letter.id, outcome: "claim_error", error: claimError.message });
        break;
      }

      const batch = claimData as ClaimBatch;
      const recipients = batch?.recipients ?? [];
      if (recipients.length === 0) break;
      batches += 1;

      for (const recipient of recipients) {
        let body: RenderedNewsletterDelivery;
        try {
          body = renderNewsletterDelivery({
            template,
            greetingName: recipient.greetingName,
            senderName: batch.senderName,
            unsubscribeUrl: unsubscribeUrl(recipient.unsubscribeToken),
            postalAddress: batch.postalAddress,
          });
        } catch (error) {
          failed += 1;
          const message = error instanceof Error ? error.message : String(error);
          const { error: recordError } = await admin.rpc("crm_record_newsletter_send_result", {
            p_recipient_id: recipient.recipientId,
            p_status: "failed",
            p_error_code: "render_error",
            p_error_message: message,
          });
          if (recordError) {
            log("error", "record_render_failed", { recipientId: recipient.recipientId, message: recordError.message });
          }
          log("error", "render_failed", { newsletterId: letter.id, recipientId: recipient.recipientId, message });
          continue;
        }
        const outcome = await sendOne(apiKey, batch, recipient, body, replyTo);

        if ("providerMessageId" in outcome) {
          sent += 1;
          const { error } = await admin.rpc("crm_record_newsletter_send_result", {
            p_recipient_id: recipient.recipientId,
            p_status: "sent",
            p_provider_message_id: outcome.providerMessageId,
          });
          if (error) log("error", "record_sent_failed", { recipientId: recipient.recipientId, message: error.message });
        } else {
          failed += 1;
          const { error } = await admin.rpc("crm_record_newsletter_send_result", {
            p_recipient_id: recipient.recipientId,
            p_status: "failed",
            p_error_code: outcome.errorCode,
            p_error_message: outcome.errorMessage,
          });
          if (error) log("error", "record_failed_failed", { recipientId: recipient.recipientId, message: error.message });
          log("warn", "send_failed", {
            newsletterId: letter.id,
            recipientId: recipient.recipientId,
            errorCode: outcome.errorCode,
          });
        }
      }
    }

    const { data: finalized } = await admin.rpc("crm_finalize_newsletter", { p_newsletter_id: letter.id });
    results.push({
      newsletterId: letter.id,
      sent,
      failed,
      batches,
      finalized: (finalized as { finalized?: boolean } | null)?.finalized ?? false,
    });
    log("info", "newsletter_run_complete", { newsletterId: letter.id, sent, failed, batches });
  }

  return json({
    releasedStaleClaims: (released as { released?: number } | null)?.released ?? 0,
    newsletters: due.length,
    results,
  });
});
