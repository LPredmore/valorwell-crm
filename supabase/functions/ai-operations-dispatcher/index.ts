// AI Operations dispatcher: runs every five minutes and performs whatever step of
// the daily America/Chicago sequence is due. Weekday-only, business-date
// idempotent, read-only against production data.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  AI_OPS_MODEL,
  AI_OPS_PROMPT_VERSION,
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

const COMPONENT = "ai-operations-dispatcher";

const ACTION_ALIASES: Record<string, DispatcherAction> = {
  collect: "collect",
  ingest: "reconcile",
  reconcile: "reconcile",
  initialize: "initialize",
  youtube: "youtube",
  brief: "brief",
  retry: "retry",
  finalize: "finalize",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!authorizeWorker(request)) return json({ error: "Unauthorized." }, 401);

  const admin = adminClient();
  const started = Date.now();

  try {
    const body = await request.json().catch(() => ({}));
    const tenantId: string = typeof body?.tenantId === "string" ? body.tenantId : AI_OPS_TENANT_ID;
    const businessDate: string = typeof body?.businessDate === "string"
      ? body.businessDate
      : centralBusinessDate();
    const localTime: string = typeof body?.localTime === "string" ? body.localTime : centralLocalTime();
    const force = body?.force === true;

    const requested = typeof body?.action === "string"
      ? ACTION_ALIASES[body.action]
      : typeof body?.phase === "string"
      ? ACTION_ALIASES[body.phase]
      : undefined;
    const action = requested ?? dispatcherActionFor(localTime);

    const flag = async (name: string) => {
      const { data } = await admin.rpc("ai_ops_worker_flag", { p_tenant_id: tenantId, p_flag_name: name });
      return data === true;
    };

    if (!(await flag("ai_operations_enabled"))) {
      logEvent(COMPONENT, "disabled", { tenantId, businessDate });
      return json({ ok: true, skipped: "ai_operations_disabled" });
    }
    if (!action) {
      return json({ ok: true, skipped: "nothing_due", localTime, businessDate });
    }
    if (isWeekend(businessDate) && !force) {
      logEvent(COMPONENT, "non_business_day", { businessDate });
      return json({ ok: true, skipped: "non_business_day", businessDate });
    }

    const cutoff = new Date().toISOString();
    // Idempotent per tenant + business date: repeated calls reuse the same run and cutoff.
    const { data: runId, error: runError } = await admin.rpc("ai_ops_begin_run", {
      p_tenant_id: tenantId,
      p_business_date: businessDate,
      p_source_cutoff_at: cutoff,
    });
    if (runError) throw new Error(runError.message);

    const results: Record<string, unknown> = { runId, businessDate, localTime, action };

    const runModule = async (
      module: string,
      enabled: boolean,
      work: () => Promise<Record<string, unknown>>,
      options: { terminal?: boolean } = {},
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
        // Collection phases leave the module RUNNING: queued Gemini work is not success.
        const terminal = options.terminal ?? false;
        await admin.rpc("ai_ops_complete_module", {
          p_module_run_id: moduleRunId,
          p_status: terminal ? "success" : "running",
          p_counts: coverage,
          p_coverage: coverage,
          p_model: AI_OPS_MODEL,
          p_prompt_version: AI_OPS_PROMPT_VERSION,
        });
        results[module] = { ...coverage, moduleStatus: terminal ? "success" : "running" };
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

    /** Terminal status is derived from the module's real work-item outcomes. */
    const finalizeModule = async (module: string) => {
      const { data, error } = await admin.rpc("ai_ops_finalize_module_status", {
        p_tenant_id: tenantId,
        p_run_id: runId,
        p_module: module,
      });
      if (error) throw new Error(`ai_ops_finalize_module_status(${module}): ${error.message}`);
      return (data ?? {}) as Record<string, unknown>;
    };


    const rpc = async (name: string, args: Record<string, unknown>) => {
      const { data, error } = await admin.rpc(name, args);
      if (error) throw new Error(`${name}: ${error.message}`);
      return (data ?? {}) as Record<string, unknown>;
    };

    const collectUpstream = async () => {
      // System Integrity is deterministic: it may complete immediately.
      await runModule("system_integrity", await flag("system_integrity_enabled"), async () => {
        await rpc("ai_ops_sync_operation_registry", { p_tenant_id: tenantId });
        return rpc("ai_ops_evaluate_system_integrity", {
          p_tenant_id: tenantId,
          p_run_id: runId,
          p_cutoff_at: cutoff,
        });
      }, { terminal: true });

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
    };

    const collectYoutube = async () =>
      await runModule("youtube", await flag("youtube_ai_enabled"), async () => {
        const { data: settings } = await admin
          .from("ai_operations_settings")
          .select("youtube_channel_id, bty_playlist_id")
          .eq("tenant_id", tenantId)
          .maybeSingle();

        const sync = await syncYoutubeComments({
          admin,
          tenantId,
          channelId: settings?.youtube_channel_id ?? null,
          btyPlaylistId: settings?.bty_playlist_id ?? null,
        });

        if (!sync.available) {
          // No credentials/configuration: report the source as unavailable, never fabricate comments.
          return { sourceAvailable: false, unavailableReason: sync.reason, batchesQueued: 0 };
        }

        const batches = await rpc("ai_ops_build_youtube_batches", {
          p_tenant_id: tenantId,
          p_run_id: runId,
        });
        return { sourceAvailable: true, ...sync, ...batches };
      });

    const reconcileModules = async () => {
      await rpc("ai_ops_expire_snoozes", { p_tenant_id: tenantId });

      const reconcile = async (module: string, enabled: boolean, ingest: string) => {
        if (!enabled) {
          results[module] = { skipped: "flag_disabled" };
          return;
        }
        try {
          const ingested = await rpc(ingest, { p_tenant_id: tenantId, p_run_id: runId });
          const status = await finalizeModule(module);
          results[module] = { ...ingested, ...status };
        } catch (moduleError) {
          results[module] = { error: safeError(moduleError) };
          logEvent(COMPONENT, "reconcile_failed", { module, runId, message: safeError(moduleError) });
        }
      };

      await reconcile("client_journey", await flag("client_journey_ai_enabled"), "ai_ops_ingest_client_journey_results");
      await reconcile("communications", await flag("communications_ai_enabled"), "ai_ops_ingest_communications_results");
      await reconcile("youtube", await flag("youtube_ai_enabled"), "ai_ops_ingest_youtube_results");
    };

    /** 04:35 — queue the brief only. The model worker processes it; ingestion happens later. */
    const queueBrief = async () =>
      await runModule("executive_brief", await flag("executive_brief_enabled"), () =>
        rpc("ai_ops_build_executive_brief_input", { p_tenant_id: tenantId, p_run_id: runId }));

    /** Ingest the completed brief work item. forcePartial publishes a partial brief at the hard cutoff. */
    const publishBrief = async (forcePartial: boolean) => {
      if (!(await flag("executive_brief_enabled"))) {
        results.executive_brief = { skipped: "flag_disabled" };
        return;
      }
      try {
        const ingested = await rpc("ai_ops_ingest_executive_brief", {
          p_tenant_id: tenantId,
          p_run_id: runId,
          p_force_partial: forcePartial,
        });
        const status = ingested.status === "pending"
          ? { module: "executive_brief", status: "running" }
          : await finalizeModule("executive_brief");
        results.executive_brief = { ...ingested, ...status };
      } catch (briefError) {
        results.executive_brief = { error: safeError(briefError) };
        logEvent(COMPONENT, "brief_failed", { runId, message: safeError(briefError) });
      }
    };

    switch (action) {
      case "initialize":
        results.initialized = true;
        break;
      case "collect":
        await collectUpstream();
        break;
      case "youtube":
        await collectYoutube();
        break;
      case "reconcile":
        await reconcileModules();
        break;
      case "brief":
        await queueBrief();
        break;
      case "retry":
        // Requeueing is handled by the work queue's own backoff; reconcile whatever finished.
        await reconcileModules();
        await publishBrief(false);
        break;
      case "finalize": {
        await reconcileModules();
        // Hard cutoff: publish a complete brief when the model result exists, otherwise an explicit partial.
        await publishBrief(true);
        const summary = await rpc("ai_ops_complete_run", { p_run_id: runId, p_coverage_summary: results });
        results.runSummary = summary;
        break;
      }
    }


    results.provider = AI_OPS_PROVIDER;
    logEvent(COMPONENT, "action_complete", { runId, businessDate, action, durationMs: Date.now() - started });
    return json({ ok: true, ...results, durationMs: Date.now() - started });
  } catch (error) {
    logEvent(COMPONENT, "dispatch_failed", { message: safeError(error) });
    return json({ error: safeError(error) }, 500);
  }
});
