import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  BTY_GEMINI_MODEL,
  BTY_PASS_TARGET_COUNT,
  BTY_TENANT_ID,
  buildStaggeredDiscoveryPrompt,
  callGeminiGrounded,
  centralBusinessDate,
  GeminiError,
  normalizeOrgName,
  validateStaggeredCandidates,
  type Candidate,
  type StaggeredRow,
} from "../_shared/bty.ts";
import { adminClient, authorizeWorker, json, logEvent, safeError } from "../_shared/bty-runtime.ts";

/** Total staggered searches per business date (06:00 and 06:05 Central). */
const TOTAL_PASSES = 2;

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const admin = adminClient();
  if (!await authorizeWorker(request, admin)) {
    return json({ error: "BTY worker authorization is required." }, 403);
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const tenantId = typeof body.tenantId === "string" ? body.tenantId : BTY_TENANT_ID;
  const requestedPass = Number(body.pass ?? body.attempt);
  const pass = Number.isFinite(requestedPass) ? Math.min(Math.max(1, requestedPass), TOTAL_PASSES) : 1;
  const businessDate = typeof body.businessDate === "string" ? body.businessDate : centralBusinessDate();
  const forceFailure = body.forceFailure === true;

  const claim = await admin.rpc("bty_claim_discovery_pass", {
    p_tenant_id: tenantId,
    p_business_date: businessDate,
    p_pass: pass,
    p_model: BTY_GEMINI_MODEL,
  });
  if (claim.error) return json({ error: claim.error.message }, 500);
  const claimed = claim.data as Record<string, unknown>;
  if (claimed.claimed !== true) {
    logEvent("bty-discovery", "skipped", { reason: claimed.reason, businessDate, pass });
    return json({ skipped: true, ...claimed });
  }

  const runId = String(claimed.runId);
  const targetState = String(claimed.targetState);
  let accepted: Candidate[] = [];

  try {
    if (forceFailure) throw new GeminiError("api_error", "Forced failure rehearsal.");

    // No ignore list is sent to the model — duplicates are filtered in code below.
    const rows = await callGeminiGrounded<StaggeredRow>(buildStaggeredDiscoveryPrompt(targetState));

    // Code-level duplicate screen against every organization already stored,
    // including anything pass 1 saved earlier the same morning.
    const screen = await admin.rpc("bty_screen_organization_candidates", {
      p_tenant_id: tenantId,
      p_run_id: runId,
      p_candidates: rows.map((row) => ({
        organization_name: row.org_name,
        website_url: row.website,
        youtube_channel_url: row.youtube_url,
        headquarters_state: row.state,
      })),
    });
    if (screen.error) throw new Error(screen.error.message);

    const duplicateVerdicts = new Map<string, string>();
    for (const entry of (screen.data as Record<string, unknown>[]) ?? []) {
      if (entry.duplicate === true && typeof entry.normalizedName === "string") {
        duplicateVerdicts.set(entry.normalizedName, String(entry.reason ?? "duplicate_organization"));
      }
    }

    const seen = await admin
      .from("bty_discovery_candidates")
      .select("normalized_name")
      .eq("run_id", runId);
    const seenNames = new Set<string>();
    for (const row of (seen.data as { normalized_name: string }[] | null) ?? []) {
      if (row.normalized_name) seenNames.add(row.normalized_name);
    }

    const outcome = validateStaggeredCandidates(rows, { targetState, seenNames, duplicateVerdicts });
    accepted = outcome.accepted;

    logEvent("bty-discovery", "pass_validated", {
      runId,
      targetState,
      pass,
      returned: rows.length,
      accepted: accepted.length,
      discarded: outcome.rejected.length,
      discardReasons: outcome.rejected.map((entry) => entry.reason),
    });

    const commit = await admin.rpc("bty_commit_discovery_pass", {
      p_run_id: runId,
      p_candidates: accepted.slice(0, BTY_PASS_TARGET_COUNT),
      p_pass: pass,
      p_advance_state: pass >= TOTAL_PASSES,
    });
    if (commit.error) throw new Error(commit.error.message);

    const summary = commit.data as Record<string, unknown>;
    logEvent("bty-discovery", "pass_committed", { runId, targetState, pass, ...summary });
    return json({
      success: true,
      runId,
      targetState,
      pass,
      returned: rows.length,
      validated: accepted.length,
      rejected: outcome.rejected.map((entry) => ({
        organizationName: entry.candidate.organization_name,
        reason: entry.reason,
      })),
      ...summary,
    });
  } catch (error) {
    const detail = safeError(error);
    const failure = await admin.rpc("bty_mark_run_failed", {
      p_run_id: runId,
      p_attempt: pass >= TOTAL_PASSES ? 3 : pass,
      p_error: {
        pass,
        message: detail.message,
        kind: detail.kind ?? "workflow_error",
        candidatesValidated: accepted.length,
        candidatesRejected: 0,
      },
    });
    logEvent("bty-discovery", "failed", { runId, targetState, pass, error: detail.message });
    return json({
      success: false,
      runId,
      targetState,
      pass,
      status: (failure.data as Record<string, unknown>)?.status ?? "pending",
      error: detail.message,
      candidatesValidated: accepted.length,
    }, 200);
  }
});
