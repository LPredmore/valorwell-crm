/**
 * Scheduled-publication reconciliation. A scheduled YouTube video is uploaded Private with
 * a native publishAt, and YouTube -- not the CRM -- makes it public. This pass reads each
 * Scheduled publication's video back from YouTube and:
 *   * moves it to Published once YouTube reports it Public (never because the clock passed);
 *   * records an exception, without rewriting CRM status, when YouTube disagrees
 *     (deleted, rejected, failed processing, unexpected privacy, publishAt missing or
 *     changed, or still Private well after its publish time);
 *   * clears a previously recorded exception once YouTube is healthy again.
 *
 * Runs from the every-minute publish dispatcher (and the AI Operations YouTube sync).
 * Due-ness is throttled per publication so quota use stays around one videos.list call
 * (1 unit, up to 50 videos) per dispatcher tick at most.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.93.1";
import type { YoutubeDeliveryStatus } from "./api.ts";

/** Allowed difference between CRM scheduled_for and YouTube publishAt. */
export const PUBLISH_AT_TOLERANCE_MS = 10_000;
/** How long after publishAt a video may stay Private before it is flagged as overdue. */
export const OVERDUE_GRACE_MS = 15 * 60 * 1000;
/** Re-check cadence once a video is due (publish time passed). */
export const DUE_RECHECK_MS = 60 * 1000;
/** Re-check cadence before the publish time (detects publishAt removal/changes). */
export const UPCOMING_RECHECK_MS = 30 * 60 * 1000;
/** Re-check cadence for a publication already flagged with an exception. */
export const EXCEPTION_RECHECK_MS = 15 * 60 * 1000;

export type ReconciliationCode =
  | "reconcile_video_missing"
  | "reconcile_upload_rejected"
  | "reconcile_processing_failed"
  | "reconcile_unexpected_privacy"
  | "reconcile_publish_at_missing"
  | "reconcile_publish_at_mismatch"
  | "reconcile_publish_overdue";

export type ReconciliationDecision =
  | { action: "publish"; publishedAt: string }
  | { action: "healthy"; state: "healthy" | "waiting" }
  | { action: "exception"; code: ReconciliationCode; reason: string };

type ReconcilablePublication = {
  scheduled_for: string | null;
  platform_payload?: Record<string, unknown> | null;
};

function lastReconciliation(pub: ReconcilablePublication): Record<string, unknown> | null {
  const value = (pub.platform_payload ?? {}).youtubeReconciliation;
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

/** Whether a scheduled publication should be read back from YouTube on this pass. */
export function reconciliationDue(pub: ReconcilablePublication, nowMs: number): boolean {
  const last = lastReconciliation(pub);
  const checkedMs = last?.checkedAt ? Date.parse(String(last.checkedAt)) : NaN;
  if (!Number.isFinite(checkedMs)) return true;
  const scheduledMs = pub.scheduled_for ? Date.parse(pub.scheduled_for) : NaN;
  const interval = last?.state === "exception" ? EXCEPTION_RECHECK_MS
    : Number.isFinite(scheduledMs) && scheduledMs <= nowMs ? DUE_RECHECK_MS
    : UPCOMING_RECHECK_MS;
  return nowMs - checkedMs >= interval;
}

export function decideReconciliation(
  pub: ReconcilablePublication,
  actual: YoutubeDeliveryStatus | null,
  nowMs: number,
): ReconciliationDecision {
  if (!actual) {
    return { action: "exception", code: "reconcile_video_missing", reason: "YouTube no longer returns this video; it may have been deleted or removed." };
  }
  if (actual.uploadStatus === "rejected") {
    return { action: "exception", code: "reconcile_upload_rejected", reason: `YouTube rejected the upload${actual.rejectionReason ? ` (${actual.rejectionReason})` : ""}.` };
  }
  if (actual.uploadStatus === "failed" || actual.uploadStatus === "deleted" || actual.processingStatus === "failed" || actual.processingStatus === "terminated") {
    return { action: "exception", code: "reconcile_processing_failed", reason: `YouTube processing failed${actual.failureReason ? ` (${actual.failureReason})` : ""}.` };
  }
  const scheduledMs = pub.scheduled_for ? Date.parse(pub.scheduled_for) : NaN;
  if (actual.privacyStatus === "public") {
    // snippet.publishedAt can still carry the upload time; only trust it once it is at or
    // after the scheduled instant, otherwise fall back to the schedule YouTube honoured.
    const reportedMs = actual.publishedAt ? Date.parse(actual.publishedAt) : NaN;
    const publishedMs = Number.isFinite(reportedMs) && (!Number.isFinite(scheduledMs) || reportedMs >= scheduledMs - PUBLISH_AT_TOLERANCE_MS)
      ? reportedMs
      : Number.isFinite(scheduledMs) && scheduledMs <= nowMs ? scheduledMs : nowMs;
    return { action: "publish", publishedAt: new Date(publishedMs).toISOString() };
  }
  if (actual.privacyStatus !== "private") {
    return { action: "exception", code: "reconcile_unexpected_privacy", reason: `YouTube reports privacy "${actual.privacyStatus}" for a video scheduled to go Public.` };
  }

  const publishAtMs = actual.publishAt ? Date.parse(actual.publishAt) : NaN;
  const passed = Number.isFinite(scheduledMs) && nowMs >= scheduledMs;
  if (!Number.isFinite(publishAtMs)) {
    return passed
      ? { action: "exception", code: "reconcile_publish_overdue", reason: "The publish time passed but the video is still Private on YouTube and has no scheduled publish time." }
      : { action: "exception", code: "reconcile_publish_at_missing", reason: "YouTube no longer has a scheduled publish time for this video; it will stay Private." };
  }
  if (!Number.isFinite(scheduledMs) || Math.abs(publishAtMs - scheduledMs) > PUBLISH_AT_TOLERANCE_MS) {
    return { action: "exception", code: "reconcile_publish_at_mismatch", reason: `YouTube will publish at ${actual.publishAt}, which differs from the CRM schedule (${pub.scheduled_for}).` };
  }
  if (passed && nowMs - scheduledMs > OVERDUE_GRACE_MS) {
    return { action: "exception", code: "reconcile_publish_overdue", reason: "The scheduled publish time passed more than 15 minutes ago but YouTube still reports the video as Private." };
  }
  return { action: "healthy", state: passed ? "waiting" : "healthy" };
}

export type ReconcileDeps = {
  db: SupabaseClient;
  now: () => number;
  youtubeToken: () => Promise<string>;
  getDeliveryStatuses: (token: string, videoIds: string[]) => Promise<Map<string, YoutubeDeliveryStatus | null>>;
  log?: (event: string, detail: Record<string, unknown>) => void;
  tenantId?: string;
  limit?: number;
};

export type ReconcileSummary = { considered: number; checked: number; published: number; exceptions: number; cleared: number };

async function insertEvent(db: SupabaseClient, pub: Record<string, unknown>, eventType: string, detail: Record<string, unknown>) {
  await db.from("ai_operations_social_publication_events").insert({
    tenant_id: pub.tenant_id, publication_id: pub.id, event_type: eventType, detail,
  });
}

export async function reconcileScheduledPublications(deps: ReconcileDeps): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = { considered: 0, checked: 0, published: 0, exceptions: 0, cleared: 0 };
  let query = deps.db.from("ai_operations_social_publications")
    .select("id, tenant_id, status, scheduled_for, external_video_id, platform_payload, error_code")
    .eq("status", "scheduled")
    .not("external_video_id", "is", null)
    .order("scheduled_for", { ascending: true })
    .limit(500);
  if (deps.tenantId) query = query.eq("tenant_id", deps.tenantId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const nowMs = deps.now();
  const rows = (data ?? []) as Record<string, unknown>[];
  summary.considered = rows.length;
  const due = rows
    .filter((row) => reconciliationDue(row as ReconcilablePublication, nowMs))
    .slice(0, deps.limit ?? 50);
  if (!due.length) return summary;

  const statuses = await deps.getDeliveryStatuses(await deps.youtubeToken(), due.map((row) => String(row.external_video_id)));
  const checkedAt = new Date(nowMs).toISOString();

  for (const row of due) {
    const actual = statuses.get(String(row.external_video_id)) ?? null;
    const decision = decideReconciliation(row as ReconcilablePublication, actual, nowMs);
    summary.checked += 1;

    // Re-read immediately before writing so a concurrent CRM edit to other payload keys
    // (e.g. the manual thumbnail confirmation) is not overwritten.
    const { data: fresh } = await deps.db.from("ai_operations_social_publications")
      .select("platform_payload, error_code, status").eq("id", row.id as string).maybeSingle();
    if (!fresh || fresh.status !== "scheduled") continue;
    const platformPayload = { ...((fresh.platform_payload ?? {}) as Record<string, unknown>) };
    const previous = lastReconciliation({ scheduled_for: null, platform_payload: platformPayload });
    const evidence = {
      privacyStatus: actual?.privacyStatus ?? null,
      publishAt: actual?.publishAt ?? null,
      uploadStatus: actual?.uploadStatus ?? null,
      processingStatus: actual?.processingStatus ?? null,
      checkedAt,
    };
    const previousCode = String(fresh.error_code ?? "");
    const clearsError = previousCode.startsWith("reconcile_") ? { error_code: null, error_message: null } : {};

    if (decision.action === "publish") {
      platformPayload.youtubeReconciliation = { state: "published", code: null, reason: null, ...evidence };
      platformPayload.youtubeVerification = { state: "verified", ...evidence, rejectionReason: null, failureReason: null, reason: null };
      const { data: updated } = await deps.db.from("ai_operations_social_publications").update({
        status: "published",
        published_at: decision.publishedAt,
        platform_upload_status: actual?.uploadStatus ?? null,
        platform_processing_status: actual?.processingStatus ?? null,
        platform_payload: platformPayload,
        ...clearsError,
      }).eq("id", row.id as string).eq("status", "scheduled").select("id");
      if (updated?.length) {
        summary.published += 1;
        await insertEvent(deps.db, row, "youtube_publication_reconciled", { publishedAt: decision.publishedAt, ...evidence });
      }
      continue;
    }

    if (decision.action === "exception") {
      platformPayload.youtubeReconciliation = { state: "exception", code: decision.code, reason: decision.reason, ...evidence };
      await deps.db.from("ai_operations_social_publications").update({
        platform_payload: platformPayload,
        platform_upload_status: actual?.uploadStatus ?? null,
        platform_processing_status: actual?.processingStatus ?? null,
        error_code: decision.code,
        error_message: decision.reason,
      }).eq("id", row.id as string).eq("status", "scheduled");
      summary.exceptions += 1;
      if (previous?.code !== decision.code) {
        await insertEvent(deps.db, row, "youtube_reconciliation_exception", { code: decision.code, reason: decision.reason, ...evidence });
        deps.log?.("reconciliation_exception", { publicationId: row.id, code: decision.code });
      }
      continue;
    }

    platformPayload.youtubeReconciliation = { state: decision.state, code: null, reason: null, ...evidence };
    await deps.db.from("ai_operations_social_publications").update({
      platform_payload: platformPayload,
      platform_upload_status: actual?.uploadStatus ?? null,
      platform_processing_status: actual?.processingStatus ?? null,
      ...clearsError,
    }).eq("id", row.id as string).eq("status", "scheduled");
    if (previous?.state === "exception") {
      summary.cleared += 1;
      await insertEvent(deps.db, row, "youtube_reconciliation_cleared", { previousCode: previous.code ?? null, ...evidence });
    }
  }
  return summary;
}
