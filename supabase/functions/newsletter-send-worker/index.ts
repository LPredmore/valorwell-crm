import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.93.1";

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

const escapeHtml = (value: string) => value
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

const stripHtml = (value: string) => value
  .replace(/<br\s*\/?>/gi, "\n")
  .replace(/<\/p>/gi, "\n\n")
  .replace(/<[^>]+>/g, "")
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

const displayFrom = (email: string, name: string | null) =>
  name && name.trim().length > 0 ? `${name.trim()} <${email}>` : email;

function unsubscribeUrl(token: string) {
  const base = (Deno.env.get("NEWSLETTER_UNSUBSCRIBE_BASE_URL") ?? DEFAULT_UNSUBSCRIBE_BASE).trim();
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}token=${encodeURIComponent(token)}`;
}

/**
 * Newsletter bodies are authored once and personalised per mailbox. Only the
 * greeting and the unsubscribe link vary, so no clinical or account data can
 * leak into a shared-mailbox send.
 */
function renderBody(
  template: { html: string | null; text: string | null },
  recipient: ClaimedRecipient,
  postalAddress: string | null,
) {
  const link = unsubscribeUrl(recipient.unsubscribeToken);
  const greeting = recipient.greetingName || "Friend";

  const substitute = (value: string) => value
    .replace(/\{\{\s*greeting_name\s*\}\}/gi, greeting)
    .replace(/\{\{\s*first_name\s*\}\}/gi, greeting)
    .replace(/\{\{\s*unsubscribe_url\s*\}\}/gi, link)
    .replace(/\{\{\s*postal_address\s*\}\}/gi, postalAddress ?? "");

  let html = substitute(template.html ?? "");
  const hasUnsubscribeMarkup = /unsubscribe/i.test(html);
  if (!hasUnsubscribeMarkup) {
    const footerLines = [
      postalAddress ? `<p style="margin:0 0 8px">${escapeHtml(postalAddress)}</p>` : "",
      `<p style="margin:0"><a href="${link}">Unsubscribe from this newsletter</a></p>`,
    ].filter(Boolean).join("");
    html += `<hr><div style="font-size:12px;color:#6b7280">${footerLines}</div>`;
  }

  let text = substitute(template.text ?? "");
  if (!text) text = stripHtml(html);
  if (!/unsubscribe/i.test(text)) {
    text += `\n\n${postalAddress ? `${postalAddress}\n` : ""}Unsubscribe from this newsletter: ${link}`;
  }

  return { html, text, unsubscribeLink: link };
}

async function sendOne(
  apiKey: string,
  batch: ClaimBatch,
  recipient: ClaimedRecipient,
  body: { html: string; text: string; unsubscribeLink: string },
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
        subject: batch.subject ?? "",
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
      .select("id, tenant_id, subject, body_html, body_text, status")
      .eq("id", newsletter.newsletterId)
      .maybeSingle();
    if (letterError || !letter) {
      results.push({ newsletterId: newsletter.newsletterId, outcome: "newsletter_unavailable" });
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
        const body = renderBody(
          { html: letter.body_html as string | null, text: letter.body_text as string | null },
          recipient,
          batch.postalAddress,
        );
        const outcome = await sendOne(apiKey, { ...batch, subject: letter.subject as string | null }, recipient, body, replyTo);

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
