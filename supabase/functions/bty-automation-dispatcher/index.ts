import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  BTY_FAILURE_RECIPIENT,
  BTY_STATE_NAMES,
  BTY_TENANT_ID,
  centralBusinessDate,
  centralLocalTime,
} from "../_shared/bty.ts";
import { adminClient, authorizeWorker, json, logEvent, safeError } from "../_shared/bty-runtime.ts";

const FUNCTIONS_BASE = `${Deno.env.get("SUPABASE_URL") ?? ""}/functions/v1`;

async function invokeInternal(name: string, body: Record<string, unknown>) {
  const response = await fetch(`${FUNCTIONS_BASE}/${name}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""}`,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

async function sendFailureNotification(
  admin: ReturnType<typeof adminClient>,
  tenantId: string,
  snapshot: Record<string, unknown>,
) {
  const claim = await admin.rpc("bty_claim_failure_notification", { p_run_id: snapshot.runId });
  if (claim.error) throw new Error(claim.error.message);
  if (claim.data !== true) return { sent: false, reason: "already_notified_or_not_failed" };

  const state = String(snapshot.targetState ?? "");
  const stateName = BTY_STATE_NAMES[state] ?? state;
  const businessDate = String(snapshot.businessDate ?? "");
  const attempts = Array.isArray(snapshot.attemptLog) ? snapshot.attemptLog as Record<string, unknown>[] : [];
  const attemptLine = (attempt: number) => {
    const entry = [...attempts].reverse().find((item) => Number(item.attempt) === attempt);
    if (!entry) return `Attempt ${attempt}: not recorded`;
    if (entry.failedAt) {
      const error = entry.error as Record<string, unknown> | undefined;
      return `Attempt ${attempt}: failed — ${error?.message ?? "unknown error"}`;
    }
    return `Attempt ${attempt}: started ${entry.startedAt}`;
  };
  const error = (snapshot.errorSummary ?? {}) as Record<string, unknown>;

  const lines = [
    `Beyond The Yellow automated discovery did not complete.`,
    ``,
    `Target state: ${stateName} (${state})`,
    `Business date: ${businessDate} (America/Chicago)`,
    `Model: ${snapshot.model ?? ""}`,
    ``,
    attemptLine(1),
    attemptLine(2),
    attemptLine(3),
    ``,
    `Final error: ${error.message ?? "unknown error"}${error.kind ? ` (${error.kind})` : ""}`,
    `Candidates validated: ${error.candidatesValidated ?? 0}`,
    `Candidates rejected: ${error.candidatesRejected ?? 0}`,
    `Subscriber relaxation tier reached: ${error.tierReached ?? "n/a"}`,
    ``,
    `The state rotation was NOT advanced — tomorrow will retry ${stateName}.`,
    `The 6:30 AM contact enrichment was skipped for ${businessDate}.`,
  ];

  const apiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  if (!apiKey) {
    logEvent("bty-automation-dispatcher", "notification_provider_missing", { runId: snapshot.runId });
    return { sent: false, reason: "resend_not_configured" };
  }

  const settings = await admin
    .from("crm_resend_email_settings")
    .select("from_email, from_name")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const from = settings.data?.from_email
    ? `${settings.data.from_name ?? "ValorWell CRM"} <${settings.data.from_email}>`
    : "ValorWell CRM <notifications@valorwell.org>";

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      from,
      to: [BTY_FAILURE_RECIPIENT],
      subject: `BTY automated discovery failed — ${stateName} — ${businessDate}`,
      text: lines.join("\n"),
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    logEvent("bty-automation-dispatcher", "notification_failed", { status: response.status, body: body.slice(0, 400) });
    return { sent: false, reason: `resend_error_${response.status}` };
  }
  return { sent: true };
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const admin = adminClient();
  if (!await authorizeWorker(request, admin)) {
    return json({ error: "BTY worker authorization is required." }, 403);
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const tenantId = typeof body.tenantId === "string" ? body.tenantId : BTY_TENANT_ID;
  const businessDate = typeof body.businessDate === "string" ? body.businessDate : centralBusinessDate();
  const localTime = typeof body.localTime === "string" ? body.localTime : centralLocalTime();
  const forceFailure = body.forceFailure === true;

  let action = typeof body.action === "string" ? body.action : "";
  // Two staggered discovery searches per active state: 06:00 and 06:05 Central.
  let attempt = Number.isFinite(Number(body.pass ?? body.attempt))
    ? Number(body.pass ?? body.attempt)
    : 0;
  if (!action) {
    if (localTime === "06:00") { action = "discovery"; attempt = 1; }
    else if (localTime === "06:05") { action = "discovery"; attempt = 2; }
    else if (localTime === "06:30") { action = "contact_enrichment"; }
  }
  if (!action) return json({ dispatched: false, localTime });

  try {
    if (action === "contact_enrichment") {
      const result = await invokeInternal("bty-contact-enrichment", { tenantId, businessDate });
      return json({ dispatched: true, action, localTime, result: result.payload });
    }

    const snapshotBefore = await admin.rpc("bty_discovery_run_snapshot", {
      p_tenant_id: tenantId,
      p_business_date: businessDate,
    });
    if (snapshotBefore.error) throw new Error(snapshotBefore.error.message);
    const before = (snapshotBefore.data ?? {}) as Record<string, unknown>;
    // Pass 2 must still run after pass 1 succeeded; bty_claim_discovery_pass
    // is the single source of truth for which pass remains outstanding.

    const discovery = await invokeInternal("bty-discovery", {
      tenantId,
      businessDate,
      pass: attempt || 1,
      forceFailure,
    });

    const snapshotAfter = await admin.rpc("bty_discovery_run_snapshot", {
      p_tenant_id: tenantId,
      p_business_date: businessDate,
    });
    const after = (snapshotAfter.data ?? {}) as Record<string, unknown>;
    let notification: Record<string, unknown> | null = null;
    if (after.status === "failed") {
      notification = await sendFailureNotification(admin, tenantId, { ...after, businessDate });
    }

    return json({
      dispatched: true,
      action,
      pass: attempt || 1,
      localTime,
      status: after.status,
      discovery: discovery.payload,
      notification,
    });
  } catch (error) {
    const detail = safeError(error);
    logEvent("bty-automation-dispatcher", "error", { action, attempt, error: detail.message });
    return json({ dispatched: false, action, error: detail.message }, 500);
  }
});
