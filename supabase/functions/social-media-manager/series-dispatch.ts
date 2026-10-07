
import { adminClient, authorizeWorker, logEvent, safeError } from "../_shared/ai-ops.ts";
import type { AuthContext } from "./context.ts";
import {
  processSeriesSchedule, seriesOpsFor, seriesStoreFor, type SeriesScheduleRow,
} from "./handlers/series.ts";

// Called by pg_cron (video-series-dispatcher-1min) via action "series_dispatch_tick" only when a week's Friday-noon Central
// deadline has passed and work is due. Gated by X-Cron-Secret / service-role bearer.
// Weeks are claimed atomically (FOR UPDATE SKIP LOCKED + lease) by video_series_claim_due.
export async function runSeriesDispatchTick(request: Request): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!authorizeWorker(request)) return { status: 401, body: { error: "Unauthorized." } };

  const db = adminClient();
  const leaseId = crypto.randomUUID();
  const { data, error } = await db.rpc("video_series_claim_due", { p_lease_id: leaseId, p_limit: 3, p_lease_seconds: 240 });
  if (error) {
    logEvent("video-series-dispatcher", "claim_failed", { error: error.message });
    return { status: 500, body: { ok: false, error: error.message } };
  }

  const results = [];
  for (const row of (data ?? []) as SeriesScheduleRow[]) {
    // Explicit tenant scoping: every handler below filters by this schedule's own tenant.
    const auth: AuthContext = {
      userId: row.created_by ?? "",
      tenantId: row.tenant_id,
      crmRole: "series_automation",
      capabilities: { mutate: true, communicate: false, manage_campaigns: false, report: false },
      db,
    };
    try {
      await processSeriesSchedule(row, leaseId, seriesOpsFor(auth), seriesStoreFor(auth));
      results.push({ id: row.id, ok: true });
    } catch (err) {
      const message = safeError(err);
      logEvent("video-series-dispatcher", "process_failed", { scheduleId: row.id, error: message });
      await db.from("ai_operations_video_series_schedules")
        .update({ last_error: message.slice(0, 500), last_error_code: "WORKER_ERROR", lease_id: null, lease_expires_at: null,
          next_attempt_at: new Date(Date.now() + 5 * 60_000).toISOString() })
        .eq("id", row.id).eq("tenant_id", row.tenant_id).eq("lease_id", leaseId);
      results.push({ id: row.id, ok: false, error: message });
    }
  }
  return { status: 200, body: { ok: results.every((r) => r.ok), claimed: results.length, results } };
}
