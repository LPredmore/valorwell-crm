import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type ClaimedWork = {
  workItemId: string;
  claimToken: string;
  attemptCount: number;
  maxAttempts: number;
};

type PreparedCommunication = {
  id: string;
  senderEmail: string;
  recipientEmail: string;
  subject?: string;
  renderedBody?: string;
  replyTo?: string;
  providerIdempotencyKey: string;
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authorization = request.headers.get("authorization") ?? "";
  if (!serviceRoleKey || authorization !== `Bearer ${serviceRoleKey}`) {
    return json({ error: "Service-role authorization is required." }, 403);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const resendApiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const unsubscribeBaseUrl = Deno.env.get("RELATIONSHIP_UNSUBSCRIBE_URL") ?? "https://crm.valorwell.org/unsubscribe";
  if (!supabaseUrl || !resendApiKey) return json({ error: "Delivery runtime is not configured." }, 503);

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const input = await request.json().catch(() => ({})) as { limit?: number; workerId?: string };
  const limit = Math.min(Math.max(Number(input.limit ?? 10), 1), 50);
  const workerId = String(input.workerId ?? `relationship-worker-${crypto.randomUUID()}`);

  const { data: claimed, error: claimError } = await admin.rpc("claim_relationship_campaign_work", {
    p_worker_id: workerId,
    p_limit: limit,
    p_lease_seconds: 300,
  });
  if (claimError) return json({ error: claimError.message }, 500);

  const results: unknown[] = [];
  for (const work of (claimed ?? []) as ClaimedWork[]) {
    const prepareKey = `worker:${work.workItemId}:attempt:${work.attemptCount}:prepare`;
    const { data: prepared, error: prepareError } = await admin.rpc("prepare_relationship_campaign_delivery", {
      p_work_item_id: work.workItemId,
      p_claim_token: work.claimToken,
      p_idempotency_key: prepareKey,
      p_unsubscribe_base_url: unsubscribeBaseUrl,
    });

    if (prepareError) {
      results.push({ workItemId: work.workItemId, outcome: "prepare_failed", error: prepareError.message });
      continue;
    }

    const communication = prepared as PreparedCommunication;
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${resendApiKey}`,
          "content-type": "application/json",
          "idempotency-key": communication.providerIdempotencyKey,
        },
        body: JSON.stringify({
          from: communication.senderEmail,
          to: [communication.recipientEmail],
          reply_to: communication.replyTo,
          subject: communication.subject ?? "ValorWell relationship outreach",
          text: communication.renderedBody ?? "",
          headers: { "X-Relationship-Communication-ID": communication.id },
        }),
      });
      const providerBody = await response.json().catch(() => ({})) as { id?: string; message?: string; name?: string };
      if (!response.ok || !providerBody.id) {
        const retryable = response.status === 429 || response.status >= 500;
        const exhausted = work.attemptCount >= work.maxAttempts;
        const outcome = retryable && !exhausted ? "retry" : "failed";
        const retryAt = outcome === "retry"
          ? new Date(Date.now() + Math.min(60, 2 ** work.attemptCount) * 60_000).toISOString()
          : null;
        const { data, error } = await admin.rpc("record_relationship_delivery_result", {
          p_communication_id: communication.id,
          p_claim_token: work.claimToken,
          p_outcome: outcome,
          p_idempotency_key: `worker:${work.workItemId}:attempt:${work.attemptCount}:result`,
          p_provider_message_id: null,
          p_provider_thread_id: null,
          p_retry_at: retryAt,
          p_error_code: providerBody.name ?? `http_${response.status}`,
          p_error_message: providerBody.message ?? "Resend rejected the delivery request.",
        });
        results.push(error ? { workItemId: work.workItemId, outcome: "result_failed", error: error.message } : data);
        continue;
      }

      const { data, error } = await admin.rpc("record_relationship_delivery_result", {
        p_communication_id: communication.id,
        p_claim_token: work.claimToken,
        p_outcome: "sent",
        p_idempotency_key: `worker:${work.workItemId}:attempt:${work.attemptCount}:result`,
        p_provider_message_id: providerBody.id,
        p_provider_thread_id: null,
        p_retry_at: null,
        p_error_code: null,
        p_error_message: null,
      });
      results.push(error ? { workItemId: work.workItemId, outcome: "result_failed", error: error.message } : data);
    } catch (error) {
      const exhausted = work.attemptCount >= work.maxAttempts;
      const outcome = exhausted ? "failed" : "retry";
      const retryAt = outcome === "retry"
        ? new Date(Date.now() + Math.min(60, 2 ** work.attemptCount) * 60_000).toISOString()
        : null;
      const message = error instanceof Error ? error.message : String(error);
      const { data, error: resultError } = await admin.rpc("record_relationship_delivery_result", {
        p_communication_id: communication.id,
        p_claim_token: work.claimToken,
        p_outcome: outcome,
        p_idempotency_key: `worker:${work.workItemId}:attempt:${work.attemptCount}:result`,
        p_provider_message_id: null,
        p_provider_thread_id: null,
        p_retry_at: retryAt,
        p_error_code: "network_error",
        p_error_message: message,
      });
      results.push(resultError ? { workItemId: work.workItemId, outcome: "result_failed", error: resultError.message } : data);
    }
  }

  return json({ workerId, claimed: (claimed ?? []).length, results });
});
