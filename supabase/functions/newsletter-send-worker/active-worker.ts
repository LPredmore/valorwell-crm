import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.93.1";

const RESEND_API = "https://api.resend.com";
const USER_AGENT = "ValorWell-CRM-Newsletter/2.0";
const DEFAULT_UNSUBSCRIBE_BASE = "https://crm.valorwell.org/newsletter/unsubscribe";
const BATCH_SIZE = 25;
const MAX_BATCHES = 4;
const RESEND_TIMEOUT_MS = 10_000;

const jsonHeaders = { "content-type": "application/json", "cache-control": "no-store" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: jsonHeaders });

type Db = ReturnType<typeof createClient>;
type ClaimedRecipient = {
  recipientId: string;
  emailMessageId: string;
  deliveryEmail: string;
  mailboxKey: string;
  greetingName: string;
  qualifyingAudiences: string[];
  unsubscribeToken: string;
  attempt: number;
  claimToken: string;
};
type ClaimBatch = {
  newsletterId: string;
  claimToken: string;
  senderEmail: string;
  senderName: string | null;
  replyToEmail: string | null;
  postalAddress: string;
  subject: string;
  preheader: string | null;
  bodyHtml: string;
  bodyText: string;
  renderHash: string;
  recipients: ClaimedRecipient[];
};
type DueNewsletter = { newsletterId: string; tenantId: string; name: string };
type ProviderOutcome =
  | { kind: "sent"; providerMessageId: string }
  | { kind: "retry"; errorCode: string; errorMessage: string; retryAfterSeconds: number }
  | { kind: "failed"; errorCode: string; errorMessage: string };

function log(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}) {
  const payload = JSON.stringify({ component: "newsletter-send-worker", event, ...fields });
  if (level === "error") console.error(payload);
  else if (level === "warn") console.warn(payload);
  else console.log(payload);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function unsubscribeUrl(token: string) {
  const base = (Deno.env.get("NEWSLETTER_UNSUBSCRIBE_BASE_URL") ?? DEFAULT_UNSUBSCRIBE_BASE).trim();
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}token=${encodeURIComponent(token)}`;
}

function renderCanonicalContent(batch: ClaimBatch, recipient: ClaimedRecipient) {
  const link = unsubscribeUrl(recipient.unsubscribeToken);
  const senderName = batch.senderName?.trim() || "ValorWell";
  const greetingName = recipient.greetingName?.trim() || "Friend";
  const values: Record<string, string> = {
    newsletter_greeting_name: greetingName,
    sender_name: senderName,
    unsubscribe_url: link,
    postal_address: batch.postalAddress,
  };
  const tokenPattern = /{{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*}}/g;

  const html = batch.bodyHtml.replace(tokenPattern, (token, key: string) => {
    if (!(key in values)) throw new Error(`UNSUPPORTED_NEWSLETTER_VARIABLE:${key}`);
    return escapeHtml(values[key]);
  });
  const text = batch.bodyText.replace(tokenPattern, (token, key: string) => {
    if (!(key in values)) throw new Error(`UNSUPPORTED_NEWSLETTER_VARIABLE:${key}`);
    return values[key];
  });
  const preheader = batch.preheader
    ? batch.preheader.replace(tokenPattern, (token, key: string) => {
        if (!(key in values)) throw new Error(`UNSUPPORTED_NEWSLETTER_VARIABLE:${key}`);
        return values[key];
      })
    : null;

  // Mandatory marketing compliance is system-owned. Authored content cannot remove it.
  const footerHtml = `<hr><div style="font-size:12px;color:#6b7280"><p style="margin:0 0 8px">${escapeHtml(batch.postalAddress)}</p><p style="margin:0"><a href="${escapeHtml(link)}">Unsubscribe from ValorWell newsletters</a></p></div>`;
  const footerText = `\n\n${batch.postalAddress}\nUnsubscribe from ValorWell newsletters: ${link}`;
  const preheaderHtml = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${escapeHtml(preheader)}</div>`
    : "";

  return {
    html: `${preheaderHtml}${html}${footerHtml}`,
    text: `${text}${footerText}`,
    unsubscribeLink: link,
  };
}

function retryDelaySeconds(attempt: number, retryAfterHeader: string | null) {
  const providerDelay = Number(retryAfterHeader);
  if (Number.isFinite(providerDelay) && providerDelay >= 1) return Math.min(Math.max(Math.round(providerDelay), 60), 3600);
  return Math.min(60 * Math.pow(2, Math.max(0, attempt - 1)), 3600);
}

async function sendOne(apiKey: string, batch: ClaimBatch, recipient: ClaimedRecipient): Promise<ProviderOutcome> {
  let rendered: ReturnType<typeof renderCanonicalContent>;
  try {
    rendered = renderCanonicalContent(batch, recipient);
  } catch (error) {
    return {
      kind: "failed",
      errorCode: "render_error",
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RESEND_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${RESEND_API}/emails`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "user-agent": USER_AGENT,
        // Stable logical-message identity. A retry must not create a second provider delivery.
        "idempotency-key": `crm-newsletter/${recipient.emailMessageId}`,
      },
      body: JSON.stringify({
        from: batch.senderName?.trim()
          ? `${batch.senderName.trim()} <${batch.senderEmail}>`
          : batch.senderEmail,
        to: [recipient.deliveryEmail],
        reply_to: batch.replyToEmail || undefined,
        subject: batch.subject,
        html: rendered.html,
        text: rendered.text,
        headers: {
          "List-Unsubscribe": `<${rendered.unsubscribeLink}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          "X-CRM-Email-Message-ID": recipient.emailMessageId,
          "X-CRM-Newsletter-ID": batch.newsletterId,
        },
      }),
      signal: controller.signal,
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "AbortError";
    return {
      kind: "retry",
      errorCode: timedOut ? "provider_timeout" : "network_error",
      errorMessage: timedOut ? `Resend request exceeded ${RESEND_TIMEOUT_MS}ms` : error instanceof Error ? error.message : String(error),
      retryAfterSeconds: retryDelaySeconds(recipient.attempt, null),
    };
  } finally {
    clearTimeout(timeout);
  }

  const provider = await response.json().catch(() => ({})) as { id?: string; message?: string; name?: string };
  if (response.ok && provider.id) return { kind: "sent", providerMessageId: provider.id };

  const errorCode = provider.name ?? `http_${response.status}`;
  const errorMessage = provider.message ?? `Resend rejected newsletter delivery with HTTP ${response.status}`;
  if (response.status === 429 || response.status >= 500) {
    return {
      kind: "retry",
      errorCode,
      errorMessage,
      retryAfterSeconds: retryDelaySeconds(recipient.attempt, response.headers.get("retry-after")),
    };
  }
  return { kind: "failed", errorCode, errorMessage };
}

async function processNewsletter(db: Db, apiKey: string, newsletter: DueNewsletter) {
  let sent = 0;
  let failed = 0;
  let retried = 0;
  let skipped = 0;
  let batches = 0;

  while (batches < MAX_BATCHES) {
    const { data: claimData, error: claimError } = await db.rpc("crm_claim_newsletter_recipients", {
      p_newsletter_id: newsletter.newsletterId,
      p_limit: BATCH_SIZE,
    });
    if (claimError) throw new Error(`CLAIM_FAILED:${claimError.message}`);
    const batch = claimData as ClaimBatch;
    const recipients = batch?.recipients ?? [];
    if (recipients.length === 0) break;
    batches += 1;

    for (const recipient of recipients) {
      // This is intentionally the final database read immediately before the external side effect.
      const { data: guardData, error: guardError } = await db.rpc("crm_newsletter_recipient_send_guard", {
        p_recipient_id: recipient.recipientId,
        p_claim_token: recipient.claimToken,
      });
      if (guardError) {
        log("error", "guard_failed", { recipientId: recipient.recipientId, message: guardError.message });
        skipped += 1;
        continue;
      }
      const guard = guardData as { allowed?: boolean; reason?: string } | null;
      if (!guard?.allowed) {
        skipped += 1;
        log("info", "recipient_stopped_by_guard", { recipientId: recipient.recipientId, reason: guard?.reason ?? "unknown" });
        continue;
      }

      const outcome = await sendOne(apiKey, batch, recipient);
      if (outcome.kind === "sent") {
        const { error } = await db.rpc("crm_record_newsletter_send_attempt", {
          p_recipient_id: recipient.recipientId,
          p_claim_token: recipient.claimToken,
          p_outcome: "sent",
          p_provider_message_id: outcome.providerMessageId,
        });
        if (error) throw new Error(`RECORD_SENT_FAILED:${error.message}`);
        sent += 1;
      } else if (outcome.kind === "retry") {
        const { error } = await db.rpc("crm_record_newsletter_send_attempt", {
          p_recipient_id: recipient.recipientId,
          p_claim_token: recipient.claimToken,
          p_outcome: "retry",
          p_error_code: outcome.errorCode,
          p_error_message: outcome.errorMessage,
          p_retry_after_seconds: outcome.retryAfterSeconds,
        });
        if (error) throw new Error(`RECORD_RETRY_FAILED:${error.message}`);
        retried += 1;
      } else {
        const { error } = await db.rpc("crm_record_newsletter_send_attempt", {
          p_recipient_id: recipient.recipientId,
          p_claim_token: recipient.claimToken,
          p_outcome: "failed",
          p_error_code: outcome.errorCode,
          p_error_message: outcome.errorMessage,
        });
        if (error) throw new Error(`RECORD_FAILED_FAILED:${error.message}`);
        failed += 1;
      }
    }
  }

  const { data: finalized, error: finalizeError } = await db.rpc("crm_finalize_newsletter", {
    p_newsletter_id: newsletter.newsletterId,
  });
  if (finalizeError) throw new Error(`FINALIZE_FAILED:${finalizeError.message}`);
  return { newsletterId: newsletter.newsletterId, sent, failed, retried, skipped, batches, finalized };
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const workerSecret = Deno.env.get("NEWSLETTER_WORKER_CRON_SECRET") ?? "";
  const apiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey || !workerSecret || !apiKey) {
    return json({ error: "Newsletter worker runtime is not configured." }, 503);
  }

  const providedSecret = request.headers.get("x-newsletter-worker-secret") ?? "";
  if (providedSecret.length !== workerSecret.length || providedSecret !== workerSecret) {
    return json({ error: "Newsletter worker authorization is required." }, 403);
  }

  const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data: released, error: releaseError } = await db.rpc("crm_release_stale_newsletter_claims", {
    p_older_than_minutes: 15,
  });
  if (releaseError) return json({ error: releaseError.message }, 500);

  const { data: dueData, error: dueError } = await db.rpc("crm_claim_due_newsletters", { p_limit: 5 });
  if (dueError) return json({ error: dueError.message }, 500);
  const due = ((dueData as { newsletters?: DueNewsletter[] } | null)?.newsletters ?? []);

  const results: unknown[] = [];
  for (const newsletter of due) {
    try {
      results.push(await processNewsletter(db, apiKey, newsletter));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log("error", "newsletter_processing_failed", { newsletterId: newsletter.newsletterId, message });
      results.push({ newsletterId: newsletter.newsletterId, error: message });
    }
  }

  return json({
    releasedStaleClaims: (released as { released?: number } | null)?.released ?? 0,
    newsletters: due.length,
    results,
  });
});
