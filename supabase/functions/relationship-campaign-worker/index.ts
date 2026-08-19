import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.93.1";
import { buildRelationshipResendContent } from "./email-content.ts";

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
  renderedHtml?: string;
  renderedText?: string;
  replyTo?: string;
  providerIdempotencyKey: string;
};

type ResendEmailRecord = {
  id?: string;
  message_id?: string;
  subject?: string;
};

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

const normalizeReplySubject = (subject: string | undefined) => {
  const base = String(subject ?? "ValorWell relationship outreach").replace(/^\s*re:\s*/i, "").trim();
  return `Re: ${base || "ValorWell relationship outreach"}`;
};

const getResendMessageId = async (apiKey: string, providerMessageId: string): Promise<string | null> => {
  const response = await fetch(`https://api.resend.com/emails/${encodeURIComponent(providerMessageId)}`, {
    headers: {
      authorization: `Bearer ${apiKey}`,
      "user-agent": "ValorWell-CRM-Relationship-Worker/1.0",
    },
  });
  if (!response.ok) return null;
  const body = await response.json().catch(() => ({})) as ResendEmailRecord;
  const messageId = String(body.message_id ?? "").trim();
  return messageId || null;
};

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  if (!serviceRoleKey || !supabaseUrl) return json({ error: "Worker runtime is not configured." }, 503);

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const authorization = request.headers.get("authorization") ?? "";
  const workerToken = request.headers.get("x-relationship-worker-token") ?? "";
  let authorized = authorization === `Bearer ${serviceRoleKey}`;
  if (!authorized && workerToken) {
    const { data, error } = await admin.rpc("relationship_worker_token_valid", {
      p_tenant_id: TENANT_ID,
      p_token: workerToken,
    });
    authorized = !error && data === true;
  }
  if (!authorized) return json({ error: "Relationship worker authorization is required." }, 403);

  const resendApiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const unsubscribeBaseUrl = Deno.env.get("RELATIONSHIP_UNSUBSCRIBE_URL") ?? "https://crm.valorwell.org/unsubscribe";
  if (!resendApiKey) return json({ error: "Delivery runtime is not configured." }, 503);

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
    let phase = "delivery";
    try {
      let deliverySubject = communication.subject;
      const deliveryHeaders: Record<string, string> = {
        "X-Relationship-Communication-ID": communication.id,
      };
      let rootMessageId: string | null = null;

      const { data: communicationRow, error: communicationRowError } = await admin
        .from("relationship_communications")
        .select("campaign_id,campaign_step_id,enrollment_id")
        .eq("tenant_id", TENANT_ID)
        .eq("id", communication.id)
        .single();
      if (communicationRowError) throw new Error(`Unable to load communication context: ${communicationRowError.message}`);

      const { data: stepRow, error: stepRowError } = await admin
        .from("relationship_campaign_steps")
        .select("position,metadata")
        .eq("tenant_id", TENANT_ID)
        .eq("id", communicationRow.campaign_step_id)
        .single();
      if (stepRowError) throw new Error(`Unable to load campaign step context: ${stepRowError.message}`);

      const stepMetadata = (stepRow?.metadata && typeof stepRow.metadata === "object")
        ? stepRow.metadata as Record<string, unknown>
        : {};
      const sendAsReply = stepMetadata.sendAsReply === true;

      if (sendAsReply) {
        phase = "thread_preparation";
        const replyToStepPosition = Math.max(1, Number(stepMetadata.replyToStepPosition ?? Number(stepRow.position) - 1));
        const { data: rootStep, error: rootStepError } = await admin
          .from("relationship_campaign_steps")
          .select("id")
          .eq("tenant_id", TENANT_ID)
          .eq("campaign_id", communicationRow.campaign_id)
          .eq("position", replyToStepPosition)
          .single();
        if (rootStepError || !rootStep?.id) {
          throw new Error(`Thread root step ${replyToStepPosition} could not be resolved.`);
        }

        const { data: rootCommunication, error: rootCommunicationError } = await admin
          .from("relationship_communications")
          .select("subject,provider_message_id,provider_thread_id,sent_at")
          .eq("tenant_id", TENANT_ID)
          .eq("enrollment_id", communicationRow.enrollment_id)
          .eq("campaign_step_id", rootStep.id)
          .eq("direction", "outbound")
          .in("status", ["sent", "delivered"])
          .not("sent_at", "is", null)
          .order("sent_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (rootCommunicationError || !rootCommunication?.provider_message_id) {
          throw new Error("Thread root message has not been sent successfully yet.");
        }

        rootMessageId = String(rootCommunication.provider_thread_id ?? "").trim() ||
          await getResendMessageId(resendApiKey, String(rootCommunication.provider_message_id));
        if (!rootMessageId) {
          throw new Error("Resend Message-ID for the thread root could not be resolved; refusing to send follow-up as a new thread.");
        }

        deliverySubject = normalizeReplySubject(String(rootCommunication.subject ?? communication.subject ?? ""));
        deliveryHeaders["In-Reply-To"] = rootMessageId;
        deliveryHeaders["References"] = rootMessageId;
        phase = "delivery";
      }

      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${resendApiKey}`,
          "content-type": "application/json",
          "idempotency-key": communication.providerIdempotencyKey,
          "user-agent": "ValorWell-CRM-Relationship-Worker/1.0",
        },
        body: JSON.stringify({
          from: communication.senderEmail,
          to: [communication.recipientEmail],
          reply_to: communication.replyTo,
          ...buildRelationshipResendContent({ ...communication, subject: deliverySubject }),
          headers: deliveryHeaders,
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
          p_provider_thread_id: rootMessageId,
          p_retry_at: retryAt,
          p_error_code: providerBody.name ?? `http_${response.status}`,
          p_error_message: providerBody.message ?? "Resend rejected the delivery request.",
        });
        results.push(error ? { workItemId: work.workItemId, outcome: "result_failed", error: error.message } : data);
        continue;
      }

      const sentMessageId = await getResendMessageId(resendApiKey, providerBody.id).catch(() => null);
      const { data, error } = await admin.rpc("record_relationship_delivery_result", {
        p_communication_id: communication.id,
        p_claim_token: work.claimToken,
        p_outcome: "sent",
        p_idempotency_key: `worker:${work.workItemId}:attempt:${work.attemptCount}:result`,
        p_provider_message_id: providerBody.id,
        p_provider_thread_id: sentMessageId ?? rootMessageId,
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
        p_error_code: phase === "thread_preparation" ? "thread_preparation_error" : "network_error",
        p_error_message: message,
      });
      results.push(resultError ? { workItemId: work.workItemId, outcome: "result_failed", error: resultError.message } : data);
    }
  }

  console.log(JSON.stringify({ component: "relationship-campaign-worker", event: "run_complete", workerId, claimed: (claimed ?? []).length }));
  return json({ workerId, claimed: (claimed ?? []).length, results });
});
