// AI Operations dispatcher: runs every five minutes and performs whatever step of
// the daily America/Chicago sequence is due. Weekday-only, business-date
// idempotent, read-only against production data except for AI Operations artifacts.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  AI_OPS_PROVIDER,
  AI_OPS_TENANT_ID,
  adminClient,
  authorizeWorker,
  centralBusinessDate,
  centralLocalTime,
  type DispatcherAction,
  dispatcherActionFor,
  isWeekend,
  json,
  logEvent,
  safeError,
} from "../_shared/ai-ops.ts";
import { syncYoutubeComments } from "../_shared/ai-ops-youtube.ts";
import { promptVersionForModule } from "../_shared/ai-ops-prompts.ts";

const COMPONENT = "ai-operations-dispatcher";
const ACTION_ALIASES: Record<string, DispatcherAction> = {
  collect: "collect", ingest: "reconcile", reconcile: "reconcile", initialize: "initialize",
  rebuild: "rebuild", youtube: "youtube", brief: "brief", retry: "retry", finalize: "finalize",
};

function modelForModule(module: string): string {
  if (module === "system_integrity") return "deterministic";
  if (module === "youtube") return "gemini-2.5-flash";
  return "gemini-2.5-pro";
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!authorizeWorker(request)) return json({ error: "Unauthorized." }, 401);
  const admin = adminClient();
  const started = Date.now();

  try {
    const body = await request.json().catch(() => ({}));
    const tenantId: string = typeof body?.tenantId === "string" ? body.tenantId : AI_OPS_TENANT_ID;
    const businessDate: string = typeof body?.businessDate === "string" ? body.businessDate : centralBusinessDate();
    const localTime: string = typeof body?.localTime === "string" ? body.localTime : centralLocalTime();
    const force = body?.force === true;
    const requested = typeof body?.action === "string" ? ACTION_ALIASES[body.action]
      : typeof body?.phase === "string" ? ACTION_ALIASES[body.phase] : undefined;
    const action = requested ?? dispatcherActionFor(localTime);

    const flag = async (name: string) => {
      const { data } = await admin.rpc("ai_ops_worker_flag", { p_tenant_id: tenantId, p_flag_name: name });
      return data === true;
    };
    if (!(await flag("ai_operations_enabled"))) return json({ ok: true, skipped: "ai_operations_disabled" });
    if (!action) return json({ ok: true, skipped: "nothing_due", localTime, businessDate });
    if (isWeekend(businessDate) && !force) return json({ ok: true, skipped: "non_business_day", businessDate });

    const cutoff = new Date().toISOString();
    const { data: runId, error: runError } = await admin.rpc("ai_ops_begin_run", {
      p_tenant_id: tenantId, p_business_date: businessDate, p_source_cutoff_at: cutoff,
    });
    if (runError) throw new Error(runError.message);
    const results: Record<string, unknown> = { runId, businessDate, localTime, action };

    const rpc = async (name: string, args: Record<string, unknown>) => {
      const { data, error } = await admin.rpc(name, args);
      if (error) throw new Error(`${name}: ${error.message}`);
      return (data ?? {}) as Record<string, unknown>;
    };

    const runModule = async (module: string, enabled: boolean, work: () => Promise<Record<string, unknown>>, options: { terminal?: boolean } = {}) => {
      if (!enabled) { results[module] = { skipped: "flag_disabled" }; return; }
      const { data: moduleRunId, error } = await admin.rpc("ai_ops_begin_module", {
        p_run_id: runId, p_module: module, p_source_cutoff_at: cutoff,
      });
      if (error) throw new Error(error.message);
      try {
        const coverage = await work();
        const terminal = options.terminal ?? false;
        await admin.rpc("ai_ops_complete_module", {
          p_module_run_id: moduleRunId,
          p_status: terminal ? "success" : "running",
          p_counts: coverage,
          p_coverage: coverage,
          p_model: modelForModule(module),
          p_prompt_version: promptVersionForModule(module),
        });
        results[module] = { ...coverage, moduleStatus: terminal ? "success" : "running" };
      } catch (moduleError) {
        await admin.rpc("ai_ops_complete_module", {
          p_module_run_id: moduleRunId, p_status: "failed", p_error_code: "module_error", p_error_summary: safeError(moduleError),
        });
        results[module] = { error: safeError(moduleError) };
        logEvent(COMPONENT, "module_failed", { module, runId, message: safeError(moduleError) });
      }
    };

    const finalizeModule = async (module: string) => {
      const { data, error } = await admin.rpc("ai_ops_finalize_module_status", {
        p_tenant_id: tenantId, p_run_id: runId, p_module: module,
      });
      if (error) throw new Error(`ai_ops_finalize_module_status(${module}): ${error.message}`);
      return (data ?? {}) as Record<string, unknown>;
    };

    const collectUpstream = async () => {
      await runModule("system_integrity", await flag("system_integrity_enabled"), async () => {
        await rpc("ai_ops_sync_operation_registry", { p_tenant_id: tenantId });
        return rpc("ai_ops_evaluate_system_integrity", { p_tenant_id: tenantId, p_run_id: runId, p_cutoff_at: cutoff });
      }, { terminal: true });
      await runModule("client_journey", await flag("client_journey_ai_enabled"), () => rpc("ai_ops_build_client_journey_batches", { p_tenant_id: tenantId, p_run_id: runId, p_cutoff_at: cutoff, p_batch_size: 8 }));
      await runModule("communications", await flag("communications_ai_enabled"), () => rpc("ai_ops_build_communications_batches", { p_tenant_id: tenantId, p_run_id: runId, p_cutoff_at: cutoff }));
      await runModule("staff_quality", await flag("staff_quality_ai_enabled"), () => rpc("ai_ops_build_staff_quality_batches", { p_tenant_id: tenantId, p_run_id: runId, p_cutoff_at: cutoff }));
      await runModule("appointment_integrity", await flag("appointment_integrity_ai_enabled"), () => rpc("ai_ops_build_appointment_integrity_batches", { p_tenant_id: tenantId, p_run_id: runId, p_cutoff_at: cutoff }));
      await runModule("billing_claims", await flag("billing_claims_ai_enabled"), () => rpc("ai_ops_build_billing_claims_batches", { p_tenant_id: tenantId, p_run_id: runId, p_cutoff_at: cutoff }));
      await runModule("data_quality", await flag("data_quality_ai_enabled"), () => rpc("ai_ops_build_data_quality_batches", { p_tenant_id: tenantId, p_run_id: runId, p_cutoff_at: cutoff }));
      await runModule("relationship_followup", await flag("relationship_followup_ai_enabled"), () => rpc("ai_ops_build_relationship_followup_batches", { p_tenant_id: tenantId, p_run_id: runId, p_cutoff_at: cutoff, p_batch_size: 8 }));
      await runModule("donor_intelligence", await flag("donor_intelligence_ai_enabled"), () => rpc("ai_ops_build_donor_intelligence_batches", { p_tenant_id: tenantId, p_run_id: runId, p_cutoff_at: cutoff, p_batch_size: 8 }));
      await runModule("social_leads", await flag("social_leads_ai_enabled"), () => rpc("ai_ops_build_social_lead_batches", { p_tenant_id: tenantId, p_run_id: runId, p_cutoff_at: cutoff, p_batch_size: 8 }));
    };

    const collectYoutube = async () => await runModule("youtube", await flag("youtube_ai_enabled"), async () => {
      const { data: settings } = await admin.from("ai_operations_settings").select("youtube_channel_id, bty_playlist_id").eq("tenant_id", tenantId).maybeSingle();
      const sync = await syncYoutubeComments({ admin, tenantId, channelId: settings?.youtube_channel_id ?? null, btyPlaylistId: settings?.bty_playlist_id ?? null });
      if (!sync.available) return { sourceAvailable: false, unavailableReason: sync.reason, batchesQueued: 0 };
      const batches = await rpc("ai_ops_build_youtube_batches", { p_tenant_id: tenantId, p_run_id: runId });
      return { sourceAvailable: true, ...sync, ...batches };
    });

    const reconcileModules = async () => {
      await rpc("ai_ops_expire_snoozes", { p_tenant_id: tenantId });
      const reconcile = async (module: string, enabled: boolean, ingest: string) => {
        if (!enabled) { results[module] = { skipped: "flag_disabled" }; return; }
        try {
          const ingested = await rpc(ingest, { p_tenant_id: tenantId, p_run_id: runId });
          results[module] = { ...ingested, ...await finalizeModule(module) };
        } catch (moduleError) {
          results[module] = { error: safeError(moduleError) };
          logEvent(COMPONENT, "reconcile_failed", { module, runId, message: safeError(moduleError) });
        }
      };
      await reconcile("client_journey", await flag("client_journey_ai_enabled"), "ai_ops_ingest_client_journey_results");
      await reconcile("communications", await flag("communications_ai_enabled"), "ai_ops_ingest_communications_results");
      await reconcile("staff_quality", await flag("staff_quality_ai_enabled"), "ai_ops_ingest_staff_quality_results");
      await reconcile("appointment_integrity", await flag("appointment_integrity_ai_enabled"), "ai_ops_ingest_appointment_integrity_results");
      await reconcile("billing_claims", await flag("billing_claims_ai_enabled"), "ai_ops_ingest_billing_claims_results");
      await reconcile("data_quality", await flag("data_quality_ai_enabled"), "ai_ops_ingest_data_quality_results");
      await reconcile("relationship_followup", await flag("relationship_followup_ai_enabled"), "ai_ops_ingest_relationship_followup_results");
      await reconcile("donor_intelligence", await flag("donor_intelligence_ai_enabled"), "ai_ops_ingest_donor_intelligence_results");
      await reconcile("social_leads", await flag("social_leads_ai_enabled"), "ai_ops_ingest_social_leads_results");
      await reconcile("youtube", await flag("youtube_ai_enabled"), "ai_ops_ingest_youtube_results");
    };

    const queueBrief = async () => await runModule("executive_brief", await flag("executive_brief_enabled"), () => rpc("ai_ops_build_executive_brief_input", { p_tenant_id: tenantId, p_run_id: runId }));
    const publishBrief = async (forcePartial: boolean) => {
      if (!(await flag("executive_brief_enabled"))) return;
      const ingested = await rpc("ai_ops_ingest_executive_brief", { p_tenant_id: tenantId, p_run_id: runId, p_force_partial: forcePartial });
      results.executive_brief = { ...ingested, ...(ingested.status === "pending" ? { module: "executive_brief", status: "running" } : await finalizeModule("executive_brief")) };
    };

    switch (action) {
      case "initialize": results.initialized = true; break;
      case "collect": await collectUpstream(); break;
      case "rebuild": results.purged = await rpc("ai_ops_purge_stale_work_items", { p_tenant_id: tenantId, p_run_id: runId }); await collectUpstream(); break;
      case "youtube": await collectYoutube(); break;
      case "reconcile": await reconcileModules(); break;
      case "brief": await queueBrief(); break;
      case "retry": await reconcileModules(); await publishBrief(false); break;
      case "finalize": await reconcileModules(); await publishBrief(true); results.runSummary = await rpc("ai_ops_complete_run", { p_run_id: runId, p_coverage_summary: results }); break;
    }

    results.provider = AI_OPS_PROVIDER;
    logEvent(COMPONENT, "action_complete", { runId, businessDate, action, durationMs: Date.now() - started });
    return json({ ok: true, ...results, durationMs: Date.now() - started });
  } catch (error) {
    logEvent(COMPONENT, "dispatch_failed", { message: safeError(error) });
    return json({ error: safeError(error) }, 500);
  }
});
