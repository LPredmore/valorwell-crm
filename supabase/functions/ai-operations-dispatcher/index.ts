// AI Operations dispatcher: runs the daily business-date sequence.
// Weekday-only, business-date idempotent, read-only against production data.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  AI_OPS_TENANT_ID,
  adminClient,
  authorizeWorker,
  centralBusinessDate,
  isWeekend,
  json,
  logEvent,
  safeError,
} from "../_shared/ai-ops.ts";

const COMPONENT = "ai-operations-dispatcher";

type Phase = "collect" | "ingest";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!authorizeWorker(request)) return json({ error: "Unauthorized." }, 401);

  const admin = adminClient();
  const started = Date.now();

  try {
    const body = await request.json().catch(() => ({}));
    const tenantId: string = typeof body?.tenantId === "string" ? body.tenantId : AI_OPS_TENANT_ID;
    const phase: Phase = body?.phase === "ingest" ? "ingest" : "collect";
    const businessDate: string = typeof body?.businessDate === "string"
      ? body.businessDate
      : centralBusinessDate();
    const force = body?.force === true;

    const flag = async (name: string) => {
      const { data } = await admin.rpc("ai_ops_worker_flag", { p_tenant_id: tenantId, p_flag_name: name });
      return data === true;
    };

    if (!(await flag("ai_operations_enabled"))) {
      logEvent(COMPONENT, "disabled", { tenantId, businessDate });
      return json({ ok: true, skipped: "ai_operations_disabled" });
    }
    if (isWeekend(businessDate) && !force) {
      logEvent(COMPONENT, "non_business_day", { businessDate });
      return json({ ok: true, skipped: "non_business_day", businessDate });
    }

    const cutoff = new Date().toISOString();
    const { data: runId, error: runError } = await admin.rpc("ai_ops_begin_run", {
      p_tenant_id: tenantId,
      p_business_date: businessDate,
      p_source_cutoff_at: cutoff,
    });
    if (runError) throw new Error(runError.message);

    const results: Record<string, unknown> = { runId, businessDate, phase };

    const runModule = async (
      module: string,
      enabled: boolean,
      work: () => Promise<Record<string, unknown>>,
    ) => {
      if (!enabled) {
        results[module] = { skipped: "flag_disabled" };
        return;
      }
      const { data: moduleRunId, error } = await admin.rpc("ai_ops_begin_module", {
        p_run_id: runId,
        p_module: module,
        p_source_cutoff_at: cutoff,
      });
      if (error) throw new Error(error.message);
      try {
        const coverage = await work();
        await admin.rpc("ai_ops_complete_module", {
          p_module_run_id: moduleRunId,
          p_status: "success",
          p_counts: coverage,
          p_coverage: coverage,
          p_model: "gemini-2.5-pro",
          p_prompt_version: "1",
        });
        results[module] = coverage;
      } catch (moduleError) {
        await admin.rpc("ai_ops_complete_module", {
          p_module_run_id: moduleRunId,
          p_status: "failed",
          p_error_code: "module_error",
          p_error_summary: safeError(moduleError),
        });
        results[module] = { error: safeError(moduleError) };
        logEvent(COMPONENT, "module_failed", { module, runId, message: safeError(moduleError) });
      }
    };

    const rpc = async (name: string, args: Record<string, unknown>) => {
      const { data, error } = await admin.rpc(name, args);
      if (error) throw new Error(`${name}: ${error.message}`);
      return (data ?? {}) as Record<string, unknown>;
    };

    if (phase === "collect") {
      await runModule("system_integrity", await flag("system_integrity_enabled"), async () => {
        await rpc("ai_ops_sync_operation_registry", { p_tenant_id: tenantId });
        return rpc("ai_ops_evaluate_system_integrity", {
          p_tenant_id: tenantId,
          p_run_id: runId,
          p_cutoff_at: cutoff,
        });
      });

      await runModule("client_journey", await flag("client_journey_ai_enabled"), () =>
        rpc("ai_ops_build_client_journey_batches", {
          p_tenant_id: tenantId,
          p_run_id: runId,
          p_cutoff_at: cutoff,
        }));

      await runModule("communications", await flag("communications_ai_enabled"), () =>
        rpc("ai_ops_build_communications_batches", {
          p_tenant_id: tenantId,
          p_run_id: runId,
          p_cutoff_at: cutoff,
        }));

      await runModule("youtube", await flag("youtube_ai_enabled"), () =>
        rpc("ai_ops_build_youtube_batches", { p_tenant_id: tenantId, p_run_id: runId }));
    } else {
      await runModule("client_journey", await flag("client_journey_ai_enabled"), () =>
        rpc("ai_ops_ingest_client_journey_results", { p_tenant_id: tenantId, p_run_id: runId }));

      await runModule("communications", await flag("communications_ai_enabled"), () =>
        rpc("ai_ops_ingest_communications_results", { p_tenant_id: tenantId, p_run_id: runId }));

      await runModule("youtube", await flag("youtube_ai_enabled"), () =>
        rpc("ai_ops_ingest_youtube_results", { p_tenant_id: tenantId, p_run_id: runId }));

      await runModule("executive_brief", await flag("executive_brief_enabled"), async () => {
        await rpc("ai_ops_build_executive_brief_input", { p_tenant_id: tenantId, p_run_id: runId });
        return rpc("ai_ops_ingest_executive_brief", { p_tenant_id: tenantId, p_run_id: runId });
      });

      const summary = await rpc("ai_ops_complete_run", { p_run_id: runId, p_coverage_summary: results });
      results.runSummary = summary;
    }

    logEvent(COMPONENT, "phase_complete", { runId, businessDate, phase, durationMs: Date.now() - started });
    return json({ ok: true, ...results, durationMs: Date.now() - started });
  } catch (error) {
    logEvent(COMPONENT, "dispatch_failed", { message: safeError(error) });
    return json({ error: safeError(error) }, 500);
  }
});
