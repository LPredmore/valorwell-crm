import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  BTY_GEMINI_MODEL,
  BTY_SUBSCRIBER_TIERS,
  BTY_TARGET_COUNT,
  BTY_TENANT_ID,
  buildDiscoveryPrompt,
  callGemini,
  centralBusinessDate,
  DISCOVERY_SCHEMA,
  GeminiError,
  normalizeOrgName,
  tierForAttempt,
  validateCandidates,
  type Candidate,
} from "../_shared/bty.ts";
import { adminClient, authorizeWorker, json, logEvent, safeError } from "../_shared/bty-runtime.ts";

const MAX_SEARCH_PASSES = 8;

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const admin = adminClient();
  if (!await authorizeWorker(request, admin)) {
    return json({ error: "BTY worker authorization is required." }, 403);
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const tenantId = typeof body.tenantId === "string" ? body.tenantId : BTY_TENANT_ID;
  const attempt = Number.isFinite(Number(body.attempt)) ? Math.max(1, Number(body.attempt)) : 1;
  const businessDate = typeof body.businessDate === "string" ? body.businessDate : centralBusinessDate();
  const forceFailure = body.forceFailure === true;

  const claim = await admin.rpc("bty_claim_discovery_run", {
    p_tenant_id: tenantId,
    p_business_date: businessDate,
    p_attempt: attempt,
    p_model: BTY_GEMINI_MODEL,
  });
  if (claim.error) return json({ error: claim.error.message }, 500);
  const claimed = claim.data as Record<string, unknown>;
  if (claimed.claimed !== true) {
    logEvent("bty-discovery", "skipped", { reason: claimed.reason, businessDate, attempt });
    return json({ skipped: true, ...claimed });
  }

  const runId = String(claimed.runId);
  const targetState = String(claimed.targetState);
  const accepted: Candidate[] = [];
  const seenNames = new Set<string>();
  const rejectedNames: string[] = [];
  let tier = 1;
  let lastError: { message: string; kind?: string } | null = null;

  try {
    if (forceFailure) throw new GeminiError("api_error", "Forced failure rehearsal.");

    for (let pass = 0; pass < MAX_SEARCH_PASSES && accepted.length < BTY_TARGET_COUNT; pass += 1) {
      const exclusions = await admin.rpc("bty_discovery_exclusions", {
        p_tenant_id: tenantId,
        p_run_id: runId,
      });
      if (exclusions.error) throw new Error(exclusions.error.message);
      const excl = exclusions.data as Record<string, string[]>;

      const prompt = buildDiscoveryPrompt({
        targetState,
        tier: tierForAttempt(tier),
        stateOrganizations: excl.stateOrganizations ?? [],
        allOrganizationNames: excl.allOrganizationNames ?? [],
        rejectedThisRun: [...(excl.rejectedThisRun ?? []), ...rejectedNames],
      });

      let result: { candidates?: Candidate[] };
      try {
        result = await callGemini<{ candidates?: Candidate[] }>({ prompt, schema: DISCOVERY_SCHEMA });
      } catch (error) {
        if (error instanceof GeminiError && error.kind === "rate_limited" && pass < MAX_SEARCH_PASSES - 1) {
          lastError = safeError(error);
          await new Promise((resolve) => setTimeout(resolve, 5_000));
          continue;
        }
        throw error;
      }

      const returned = Array.isArray(result?.candidates) ? result.candidates : [];
      if (!returned.length) {
        tier = Math.min(tier + 1, BTY_SUBSCRIBER_TIERS.length);
        continue;
      }

      // Backend duplicate screen against every existing CRM organization.
      const screen = await admin.rpc("bty_screen_organization_candidates", {
        p_tenant_id: tenantId,
        p_run_id: runId,
        p_candidates: returned,
      });
      if (screen.error) throw new Error(screen.error.message);
      const verdicts = new Map<string, string>();
      for (const entry of (screen.data as Record<string, unknown>[]) ?? []) {
        if (entry.duplicate === true && typeof entry.normalizedName === "string") {
          verdicts.set(entry.normalizedName, String(entry.reason ?? "duplicate_organization"));
        }
      }

      const outcome = validateCandidates(returned, {
        targetState,
        tier,
        seenNames,
        duplicateVerdicts: verdicts,
      });

      const verdictRows: Record<string, unknown>[] = [];
      for (const rejection of outcome.rejected) {
        const normalized = normalizeOrgName(rejection.candidate.organization_name);
        if (!normalized || seenNames.has(normalized)) continue;
        seenNames.add(normalized);
        rejectedNames.push(String(rejection.candidate.organization_name ?? normalized));
        verdictRows.push({
          organization_name: rejection.candidate.organization_name,
          verdict: "rejected",
          reason: rejection.reason,
          subscriber_range_tier: String(tier),
          payload: rejection.candidate,
        });
      }
      if (verdictRows.length) {
        const recorded = await admin.rpc("bty_record_candidate_verdicts", {
          p_run_id: runId,
          p_verdicts: verdictRows,
        });
        if (recorded.error) throw new Error(recorded.error.message);
      }

      for (const candidate of outcome.accepted) {
        if (accepted.length >= BTY_TARGET_COUNT) break;
        const normalized = normalizeOrgName(candidate.organization_name);
        if (!normalized || seenNames.has(normalized)) continue;
        seenNames.add(normalized);
        accepted.push(candidate);
      }

      if (accepted.length < BTY_TARGET_COUNT) {
        tier = Math.min(tier + 1, BTY_SUBSCRIBER_TIERS.length);
      }
    }

    if (accepted.length < BTY_TARGET_COUNT) {
      throw new Error(`Only ${accepted.length} qualifying organizations could be validated for ${targetState}.`);
    }

    const commit = await admin.rpc("bty_commit_discovery_batch", {
      p_run_id: runId,
      p_candidates: accepted.slice(0, BTY_TARGET_COUNT),
    });
    if (commit.error) throw new Error(commit.error.message);

    logEvent("bty-discovery", "success", { runId, targetState, attempt, tier });
    return json({ success: true, runId, targetState, attempt, ...(commit.data as Record<string, unknown>) });
  } catch (error) {
    const detail = safeError(error);
    lastError = detail;
    const failure = await admin.rpc("bty_mark_run_failed", {
      p_run_id: runId,
      p_attempt: attempt,
      p_error: {
        attempt,
        message: detail.message,
        kind: detail.kind ?? "workflow_error",
        candidatesValidated: accepted.length,
        candidatesRejected: rejectedNames.length,
        tierReached: tier,
      },
    });
    logEvent("bty-discovery", "failed", { runId, targetState, attempt, error: detail.message });
    return json({
      success: false,
      runId,
      targetState,
      attempt,
      status: (failure.data as Record<string, unknown>)?.status ?? "pending",
      error: lastError.message,
      candidatesValidated: accepted.length,
      tierReached: tier,
    }, 200);
  }
});
