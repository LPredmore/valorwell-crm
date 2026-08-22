// AI Operations dispatcher: runs every five minutes and performs whatever step of
// the daily America/Chicago sequence is due. Bucket 2 monitoring is deterministic
// and runs seven days a week. Qualitative/model-backed analysis is manual/on-demand.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  AI_OPS_TENANT_ID,
  adminClient,
  authorizeWorker,
  centralBusinessDate,
  centralLocalTime,
  type DispatcherAction,
  dispatcherActionFor,
  json,
  logEvent,
  safeError,
} from "../_shared/ai-ops.ts";

const COMPONENT = "ai-operations-dispatcher";
const ACTION_ALIASES: Record<string, DispatcherAction> = {
  collect: "collect", ingest: "reconcile", reconcile: "reconcile", initialize: "initialize",
  rebuild: "rebuild", integrity: "integrity", youtube: "youtube", brief: "brief", retry: "retry", finalize: "finalize",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!authorizeWorker(request)) return json({ error: "Unauthorized." }, 401);
  const admin = adminClient();
  const started = Date.now();

  try {
    const body = await request.json().catch(() => ({}));
    const tenantId = typeof body?.tenantId === "string" ? body.tenantId : AI_OPS_TENANT_ID;
    const businessDate = typeof body?.businessDate === "string" ? body.businessDate : centralBusinessDate();
    const localTime = typeof body?.localTime === "string" ? body.localTime : centralLocalTime();
    const requested = typeof body?.action === "string" ? ACTION_ALIASES[body.action]
      : typeof body?.phase === "string" ? ACTION_ALIASES[body.phase] : undefined;
    const action = requested ?? dispatcherActionFor(localTime);

    const flag = async (name: string) => {
      const { data } = await admin.rpc("ai_ops_worker_flag", { p_tenant_id: tenantId, p_flag_name: name });
      return data === true;
    };

    if (!(await flag("ai_operations_enabled"))) return json({ ok: true, skipped: "ai_operations_disabled" });
    if (!action) return json({ ok: true, skipped: "nothing_due", localTime, businessDate });

    const cutoff = new Date().toISOString();
    const { data: runId, error: runError } = await admin.rpc("ai_ops_begin_run", {
      p_tenant_id: tenantId,
      p_business_date: businessDate,
      p_source_cutoff_at: cutoff,
    });
    if (runError) throw new Error(runError.message);

    const results: Record<string, unknown> = { runId, businessDate, localTime, action };

    const rpc = async (name: string, args: Record<string, unknown>) => {
      const { data, error } = await admin.rpc(name, args);
      if (error) throw new Error(`${name}: ${error.message}`);
      return (data ?? {}) as Record<string, unknown>;
    };

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
        const { error: completeError } = await admin.rpc("ai_ops_complete_module", {
          p_module_run_id: moduleRunId,
          p_status: "success",
          p_counts: coverage,
          p_coverage: coverage,
          p_model: "deterministic",
          p_prompt_version: "deterministic-v1",
        });
        if (completeError) throw new Error(completeError.message);
        results[module] = { ...coverage, moduleStatus: "success", model: "deterministic" };
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

    const collectBucket2 = async () => {
      await runModule("system_integrity", await flag("system_integrity_enabled"), () =>
        rpc("ai_ops_evaluate_system_integrity", {
          p_tenant_id: tenantId, p_run_id: runId, p_cutoff_at: cutoff,
        }));

      await runModule("user_flow_smoke", await flag("user_flow_smoke_enabled"), () =>
        rpc("ai_ops_evaluate_user_flow_smoke", {
          p_tenant_id: tenantId, p_run_id: runId, p_cutoff_at: cutoff,
        }));

      await runModule("client_journey", await flag("client_journey_monitoring_enabled"), () =>
        rpc("ai_ops_evaluate_client_journey_deterministic", {
          p_tenant_id: tenantId, p_run_id: runId, p_cutoff_at: cutoff,
        }));

      await runModule("staff_quality", await flag("staff_workflow_monitoring_enabled"), () =>
        rpc("ai_ops_evaluate_staff_workflow_deterministic", {
          p_tenant_id: tenantId, p_run_id: runId, p_cutoff_at: cutoff,
        }));

      await runModule("appointment_integrity", await flag("appointment_integrity_monitoring_enabled"), () =>
        rpc("ai_ops_evaluate_appointment_integrity_deterministic", {
          p_tenant_id: tenantId, p_run_id: runId, p_cutoff_at: cutoff,
        }));

      await runModule("billing_claims", await flag("billing_claims_monitoring_enabled"), () =>
        rpc("ai_ops_evaluate_billing_claims_deterministic", {
          p_tenant_id: tenantId, p_run_id: runId, p_cutoff_at: cutoff,
        }));

      await runModule("data_quality", await flag("data_quality_monitoring_enabled"), () =>
        rpc("ai_ops_evaluate_data_quality_deterministic", {
          p_tenant_id: tenantId, p_run_id: runId, p_cutoff_at: cutoff,
        }));

      await runModule("relationship_followup", await flag("relationship_followup_monitoring_enabled"), () =>
        rpc("ai_ops_evaluate_relationship_followup_deterministic", {
          p_tenant_id: tenantId, p_run_id: runId, p_cutoff_at: cutoff,
        }));

      await runModule("sop_compliance", await flag("sop_compliance_monitoring_enabled"), () =>
        rpc("ai_ops_evaluate_sop_compliance_deterministic", {
          p_tenant_id: tenantId, p_run_id: runId, p_cutoff_at: cutoff,
        }));
    };

    const refreshSystemIntegrity = async () => {
      if (!(await flag("system_integrity_enabled"))) {
        results.system_integrity = { skipped: "flag_disabled" };
        return;
      }
      results.system_integrity = await rpc("ai_ops_evaluate_system_integrity", {
        p_tenant_id: tenantId, p_run_id: runId, p_cutoff_at: cutoff,
      });
    };

    const housekeeping = async () => {
      results.snoozes = await rpc("ai_ops_expire_snoozes", { p_tenant_id: tenantId });
    };

    const publishDeterministicSummary = async () => {
      await runModule("executive_brief", await flag("executive_brief_enabled"), () =>
        rpc("ai_ops_publish_deterministic_daily_summary", {
          p_tenant_id: tenantId,
          p_run_id: runId,
        }));
    };

    switch (action) {
      case "initialize":
        results.initialized = true;
        break;
      case "collect":
        await collectBucket2();
        break;
      case "integrity":
        await refreshSystemIntegrity();
        break;
      case "rebuild":
        results.purged = await rpc("ai_ops_purge_stale_work_items", { p_tenant_id: tenantId, p_run_id: runId });
        await collectBucket2();
        break;
      case "youtube":
        results.youtube = { skipped: "manual_analysis_bucket" };
        break;
      case "reconcile":
        await housekeeping();
        break;
      case "brief":
        await publishDeterministicSummary();
        break;
      case "retry":
        await housekeeping();
        await publishDeterministicSummary();
        break;
      case "finalize":
        await housekeeping();
        await publishDeterministicSummary();
        results.runSummary = await rpc("ai_ops_complete_run", {
          p_run_id: runId,
          p_coverage_summary: results,
        });
        break;
    }

    results.provider = "deterministic";
    logEvent(COMPONENT, "action_complete", {
      runId, businessDate, action, provider: "deterministic", durationMs: Date.now() - started,
    });
    return json({ ok: true, ...results, durationMs: Date.now() - started });
  } catch (error) {
    logEvent(COMPONENT, "dispatch_failed", { message: safeError(error) });
    return json({ error: safeError(error) }, 500);
  }
});
