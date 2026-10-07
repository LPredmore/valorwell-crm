import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.93.1";
import {
  renderNewsletterDelivery,
  validateNewsletterTemplateContract,
  type RenderedNewsletterDelivery,
} from "./rendering.ts";
import {
  classifyNewsletterSendFailure,
  newsletterIdempotencyKey,
  type NewsletterSendFailure,
} from "./delivery-contract.ts";

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

function displayFrom(email: string, name: string | null): string {
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedName = String(name ?? "").replace(/[<>\r\n]/g, "").trim();
  return normalizedName ? `${normalizedName} <${normalizedEmail}>` : normalizedEmail;
}

function unsubscribeUrl(token: string): string {
  const normalized = token.trim();
  if (!normalized) throw new Error("NEWSLETTER_UNSUBSCRIBE_TOKEN_REQUIRED");
  return `${DEFAULT_UNSUBSCRIBE_BASE}?token=${encodeURIComponent(normalized)}`;
}

async function sendOne(
  apiKey: string,
  batch: ClaimBatch,
  recipient: ClaimedRecipient,
  body: RenderedNewsletterDelivery,
  replyTo: string | null,
): Promise<{ providerMessageId: string } | NewsletterSendFailure> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  let response: Response;
  try {
    response = await fetch(`${RESEND_API}/emails`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "user-agent": USER_AGENT,
        // Stable per logical ledger message: every retry reuses the exact same
        // Resend idempotency key, including after an ambiguous network failure.
        "idempotency-key": newsletterIdempotencyKey(recipient.emailMessageId),
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
    return classifyNewsletterSendFailure({
      networkError: true,
      errorCode: error instanceof DOMException && error.name === "AbortError" ? "timeout" : "network_error",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  } finally {
    clearTimeout(timeout);
  }

  const provider = await response.json().catch(() => ({})) as { id?: string; message?: string; name?: string };
  if (!response.ok || !provider.id) {
    return classifyNewsletterSendFailure({
      status: response.status,
      errorCode: provider.name ?? `http_${response.status}`,
      errorMessage: provider.message ?? "Resend rejected the newsletter delivery",
      retryAfterHeader: response.headers.get("retry-after"),
    });
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

  // Recovery: a `sending` newsletter with no remaining recipient work is
  // finalized (completed or failed) regardless of whether pending work exists.
  const { data: reconciled, error: reconcileError } = await admin.rpc("crm_reconcile_sending_newsletters");
  if (reconcileError) log("error", "reconcile_failed", { message: reconcileError.message });

  // One authoritative claim path for cron and immediate wake-up runs. The
  // database runs template preflight and fails invalid newsletters itself.
  const { data: claimed, error: claimDueError } = await admin.rpc("crm_claim_due_newsletters", {
    p_limit: 5,
    p_newsletter_id: input.newsletterId ? String(input.newsletterId) : null,
  });
  if (claimDueError) return json({ error: claimDueError.message }, 500);
  const claimedPayload = (claimed as { newsletters?: DueNewsletter[]; failed?: unknown[] } | null) ?? {};
  const due: DueNewsletter[] = claimedPayload.newsletters ?? [];
  for (const failure of claimedPayload.failed ?? []) log("error", "newsletter_preflight_failed", { failure });

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
      // Permanent preflight failure: never leave the newsletter at `sending`.
      const message = error instanceof Error ? error.message : String(error);
      log("error", "template_contract_invalid", { newsletterId: letter.id, message });
      const { error: failError } = await admin.rpc("crm_fail_newsletter", {
        p_newsletter_id: letter.id,
        p_code: "template_invalid",
        p_message: message,
      });
      if (failError) log("error", "fail_newsletter_failed", { newsletterId: letter.id, message: failError.message });
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
    let retried = 0;
    let recordingErrors = 0;
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
          const { error: recordError } = await admin.rpc("crm_record_newsletter_send_attempt", {
            p_recipient_id: recipient.recipientId,
            p_claim_token: batch.claimToken,
            p_outcome: "failed",
            p_error_code: "render_error",
            p_error_message: message,
          });
          if (recordError) {
            recordingErrors += 1;
            log("error", "record_render_failed", { recipientId: recipient.recipientId, message: recordError.message });
          }
          log("error", "render_failed", { newsletterId: letter.id, recipientId: recipient.recipientId, message });
          continue;
        }
        // Final authoritative check immediately before provider delivery:
        // cancellation, runtime pause, suppression, eligibility, already-sent.
        const { data: guard, error: guardError } = await admin.rpc("crm_newsletter_recipient_send_guard", {
          p_recipient_id: recipient.recipientId,
          p_claim_token: batch.claimToken,
        });
        const guardResult = guard as { allowed?: boolean; reason?: string } | null;
        if (guardError || !guardResult?.allowed) {
          skipped += 1;
          log("warn", "send_guard_blocked", {
            newsletterId: letter.id,
            recipientId: recipient.recipientId,
            reason: guardError ? `guard_error:${guardError.message}` : guardResult?.reason ?? "unknown",
          });
          continue;
        }
        const outcome = await sendOne(apiKey, batch, recipient, body, replyTo);

        if ("providerMessageId" in outcome) {
          sent += 1;
          const { error } = await admin.rpc("crm_record_newsletter_send_attempt", {
            p_recipient_id: recipient.recipientId,
            p_claim_token: batch.claimToken,
            p_outcome: "sent",
            p_provider_message_id: outcome.providerMessageId,
          });
          if (error) {
            recordingErrors += 1;
            log("error", "record_sent_failed", { recipientId: recipient.recipientId, message: error.message });
          }
        } else {
          const { error } = await admin.rpc("crm_record_newsletter_send_attempt", {
            p_recipient_id: recipient.recipientId,
            p_claim_token: batch.claimToken,
            p_outcome: outcome.outcome,
            p_error_code: outcome.errorCode,
            p_error_message: outcome.errorMessage,
            p_retry_after_seconds: outcome.retryAfterSeconds ?? null,
          });
          if (error) {
            recordingErrors += 1;
            log("error", "record_send_outcome_failed", { recipientId: recipient.recipientId, message: error.message });
          } else if (outcome.outcome === "retry") {
            retried += 1;
          } else {
            failed += 1;
          }
          log(outcome.outcome === "retry" ? "warn" : "error", "send_failed", {
            newsletterId: letter.id,
            recipientId: recipient.recipientId,
            errorCode: outcome.errorCode,
            outcome: outcome.outcome,
            retryAfterSeconds: outcome.retryAfterSeconds ?? null,
          });
        }
      }
    }

    const { data: finalized } = await admin.rpc("crm_finalize_newsletter", { p_newsletter_id: letter.id });
    results.push({
      newsletterId: letter.id,
      sent,
      failed,
      retried,
      recordingErrors,
      batches,
      finalized: (finalized as { finalized?: boolean } | null)?.finalized ?? false,
    });
    log("info", "newsletter_run_complete", {
      newsletterId: letter.id,
      sent,
      failed,
      retried,
      recordingErrors,
      batches,
    });
  }

  return json({
    releasedStaleClaims: (released as { released?: number } | null)?.released ?? 0,
    newsletters: due.length,
    results,
  });
});
