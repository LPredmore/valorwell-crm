import type { AuthContext } from "../context.ts";
import { isVerifiedCurrentShortRender } from "../../_shared/short-render-profile.ts";
import { buildYoutubeStatus, type YoutubeDeliveryStatus, type YoutubeVideoStatus } from "../../_shared/youtube-publish/api.ts";
import { verifyScheduledDelivery } from "../../_shared/youtube-publish/status.ts";
import {
  ACTIVE_STATUSES, assertTransition, CANCELLABLE_STATUSES, LOCKED_STATUSES, PRE_UPLOAD_RESCHEDULE_STATUSES,
} from "../lifecycle.ts";
import type { PublicationSource, PublicationStatus, SocialPublication, ValidationResult } from "../types.ts";

/** YouTube calls the control plane makes for an already-uploaded video. Injected so the
 * handler never builds credentials itself and can be exercised without the network. */
export type YoutubeScheduleClient = {
  getDeliveryStatus(videoId: string): Promise<YoutubeDeliveryStatus>;
  updateStatus(videoId: string, status: YoutubeVideoStatus): Promise<void>;
};

const PUBLICATION_SELECT =
  "*, ai_operations_social_publication_playlists(playlist_id, is_default, ai_operations_social_playlists(display_name))";

/** Minimum lead time for a schedule; YouTube rejects a publishAt that is not in the future. */
export const MIN_SCHEDULE_LEAD_MS = 60_000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returned for any source or playlist the caller's tenant does not own, so a probe cannot
 * distinguish "exists in another tenant" from "does not exist". */
const SOURCE_NOT_FOUND = "Source video not found in your CRM tenant.";
const PLAYLIST_NOT_ALLOWED = "One or more selected playlists are not available for this publication's YouTube account.";

async function loadPublication(auth: AuthContext, id: string) {
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) throw new Error("Publication not found");
  const { data, error } = await auth.db
    .from("ai_operations_social_publications")
    .select(PUBLICATION_SELECT)
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Publication not found");
  return data as Record<string, unknown>;
}

async function insertEvent(auth: AuthContext, publicationId: string, eventType: string, detail: Record<string, unknown>) {
  const { error } = await auth.db.from("ai_operations_social_publication_events").insert({
    tenant_id: auth.tenantId,
    publication_id: publicationId,
    event_type: eventType,
    detail: { ...detail, actorProfileId: auth.userId || null },
  });
  if (error) throw new Error(error.message);
}

function toApiShape(row: Record<string, unknown>): SocialPublication {
  const playlists = (row.ai_operations_social_publication_playlists as Array<Record<string, unknown>> ?? []).map((link) => ({
    playlistId: String(link.playlist_id),
    displayName: String((link.ai_operations_social_playlists as Record<string, unknown> | null)?.display_name ?? ""),
    isDefault: Boolean(link.is_default),
  }));
  const platformPayload = (row.platform_payload as Record<string, unknown> | null) ?? {};
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    accountId: String(row.account_id),
    sourceType: row.source_type as SocialPublication["sourceType"],
    clipId: row.clip_id as string | null,
    projectId: String(row.project_id),
    contentFormat: row.content_format as SocialPublication["contentFormat"],
    status: row.status as SocialPublication["status"],
    deliveryMode: row.delivery_mode as SocialPublication["deliveryMode"],
    scheduledFor: row.scheduled_for as string | null,
    desiredPrivacyStatus: row.desired_privacy_status as SocialPublication["desiredPrivacyStatus"],
    externalVideoId: row.external_video_id as string | null,
    externalUrl: row.external_url as string | null,
    thumbnailStatus: String(((platformPayload.thumbnail as Record<string, unknown> | undefined)?.apiStatus) ?? "") || null,
    title: row.title as string | null,
    description: String(row.description ?? ""),
    tags: (row.tags as string[]) ?? [],
    hashtags: (row.hashtags as string[]) ?? [],
    categoryId: String(row.category_id),
    categoryName: String(row.category_name),
    defaultLanguage: String(row.default_language),
    license: String(row.license),
    madeForKids: Boolean(row.made_for_kids),
    containsSyntheticMedia: Boolean(row.contains_synthetic_media),
    embeddable: Boolean(row.embeddable),
    publicStatsViewable: Boolean(row.public_stats_viewable),
    notifySubscribers: Boolean(row.notify_subscribers),
    thumbnailFileId: row.thumbnail_file_id as string | null,
    thumbnailUrl: row.thumbnail_url as string | null,
    thumbnailDelivery: (platformPayload.thumbnail as SocialPublication["thumbnailDelivery"] | undefined) ?? null,
    youtubeVerification: (platformPayload.youtubeVerification as SocialPublication["youtubeVerification"] | undefined) ?? null,
    youtubeSchedule: (platformPayload.youtubeSchedule as SocialPublication["youtubeSchedule"] | undefined) ?? null,
    reconciliation: (platformPayload.youtubeReconciliation as SocialPublication["reconciliation"] | undefined) ?? null,
    platformUploadStatus: row.platform_upload_status as string | null,
    platformProcessingStatus: row.platform_processing_status as string | null,
    approvedAt: row.approved_at as string | null,
    uploadStartedAt: row.upload_started_at as string | null,
    uploadedAt: row.uploaded_at as string | null,
    publishedAt: row.published_at as string | null,
    attemptCount: Number(row.attempt_count ?? 0),
    errorCode: row.error_code as string | null,
    errorMessage: row.error_message as string | null,
    playlists,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function listPublications(auth: AuthContext, params: { status?: string; scheduledOnly?: boolean } = {}) {
  let query = auth.db
    .from("ai_operations_social_publications")
    .select(PUBLICATION_SELECT)
    .eq("tenant_id", auth.tenantId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (params.status) query = query.eq("status", params.status);
  if (params.scheduledOnly) query = query.not("scheduled_for", "is", null);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => toApiShape(row as Record<string, unknown>));
}

/** What is being published: enough source context for an operator to confirm it is the
 * right media before approving, without opening the video pipeline. */
async function loadSourceSummary(auth: AuthContext, row: Record<string, unknown>): Promise<PublicationSource> {
  const { data: project } = await auth.db
    .from("ai_operations_video_projects")
    .select("guest_name, organization_name, duration_seconds, source_file_id, source_file_name")
    .eq("id", row.project_id as string)
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();

  if (row.source_type === "clip") {
    const { data: clip } = await auth.db
      .from("ai_operations_video_clips")
      .select("clip_type, drive_file_id, start_seconds, end_seconds, status")
      .eq("id", row.clip_id as string)
      .maybeSingle();
    let renderVerified: boolean | null = null;
    if (clip?.clip_type === "short") {
      const { data: renderJob } = await auth.db
        .from("ai_operations_video_jobs")
        .select("payload, completed_at")
        .eq("job_type", "render_clip")
        .eq("clip_id", row.clip_id as string)
        .eq("status", "complete")
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      renderVerified = isVerifiedCurrentShortRender(renderJob?.payload ?? {}, clip.drive_file_id as string | null);
    }
    return {
      guestName: (project?.guest_name as string | null) ?? null,
      organizationName: (project?.organization_name as string | null) ?? null,
      durationSeconds: clip ? Number(clip.end_seconds) - Number(clip.start_seconds) : null,
      sourceFileId: (clip?.drive_file_id as string | null) ?? null,
      sourceFileName: null,
      clipType: (clip?.clip_type as string | null) ?? null,
      clipStatus: (clip?.status as string | null) ?? null,
      mediaReady: Boolean(clip?.drive_file_id) && clip?.status === "rendered",
      renderVerified,
    };
  }
  return {
    guestName: (project?.guest_name as string | null) ?? null,
    organizationName: (project?.organization_name as string | null) ?? null,
    durationSeconds: (project?.duration_seconds as number | null) ?? null,
    sourceFileId: (project?.source_file_id as string | null) ?? null,
    sourceFileName: (project?.source_file_name as string | null) ?? null,
    clipType: null,
    clipStatus: null,
    mediaReady: Boolean(project?.source_file_id),
    renderVerified: null,
  };
}

export async function getPublication(auth: AuthContext, params: { id: string }) {
  const row = await loadPublication(auth, params.id);
  return { ...toApiShape(row), source: await loadSourceSummary(auth, row) };
}

/**
 * Proves the browser-named source belongs to the caller's CRM tenant BEFORE any
 * service-role write. The BEFORE INSERT trigger derives tenant_id from the source, so
 * without this check a foreign clip/project UUID would create a publication in (and leak
 * metadata from) another tenant.
 */
export async function assertSourceOwnedByTenant(
  auth: AuthContext,
  sourceType: "clip" | "project",
  sourceId: string,
): Promise<{ projectId: string }> {
  if (typeof sourceId !== "string" || !UUID_PATTERN.test(sourceId)) throw new Error(SOURCE_NOT_FOUND);

  let projectId = sourceId;
  if (sourceType === "clip") {
    const { data: clip, error } = await auth.db
      .from("ai_operations_video_clips")
      .select("id, project_id")
      .eq("id", sourceId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!clip?.project_id) throw new Error(SOURCE_NOT_FOUND);
    projectId = String(clip.project_id);
  }

  const { data: project, error: projectError } = await auth.db
    .from("ai_operations_video_projects")
    .select("id, tenant_id")
    .eq("id", projectId)
    .maybeSingle();
  if (projectError) throw new Error(projectError.message);
  if (!project || project.tenant_id !== auth.tenantId) throw new Error(SOURCE_NOT_FOUND);
  return { projectId };
}

/** Parses a browser-supplied schedule and requires it to be comfortably in the future. */
export function normalizeFutureSchedule(value: unknown, nowMs = Date.now()): string {
  if (value === null || value === undefined || value === "") throw new Error("A scheduled publish time is required.");
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isFinite(parsed)) throw new Error("scheduledFor must be a valid ISO timestamp.");
  if (parsed < nowMs + MIN_SCHEDULE_LEAD_MS) throw new Error("Scheduled publish time must be at least 1 minute in the future.");
  return new Date(parsed).toISOString();
}

export async function createPublication(
  auth: AuthContext,
  params: { sourceType: "clip" | "project"; clipId?: string; projectId?: string; deliveryMode?: "immediate" | "scheduled"; scheduledFor?: string },
) {
  if (params.sourceType !== "clip" && params.sourceType !== "project") throw new Error("sourceType must be clip or project");
  if (params.sourceType === "clip" && !params.clipId) throw new Error("clipId is required for source_type=clip");
  if (params.sourceType === "project" && !params.projectId) throw new Error("projectId is required for source_type=project");
  const deliveryMode = params.deliveryMode ?? "immediate";
  if (deliveryMode !== "immediate" && deliveryMode !== "scheduled") throw new Error("deliveryMode must be immediate or scheduled");
  const scheduledFor = deliveryMode === "scheduled" ? normalizeFutureSchedule(params.scheduledFor) : null;

  const sourceId = (params.sourceType === "clip" ? params.clipId : params.projectId) as string;
  await assertSourceOwnedByTenant(auth, params.sourceType, sourceId);

  const existingQuery = auth.db
    .from("ai_operations_social_publications")
    .select("id")
    .eq("tenant_id", auth.tenantId)
    .in("status", [...ACTIVE_STATUSES]);
  const { data: existing, error: existingError } = params.sourceType === "clip"
    ? await existingQuery.eq("clip_id", sourceId)
    : await existingQuery.eq("project_id", sourceId).eq("content_format", "full_episode").is("clip_id", null);
  if (existingError) throw new Error(existingError.message);
  if (existing?.length) throw new Error("An active publication already exists for this source");

  // Only source identity and schedule are passed -- everything else (tenant, project, content
  // format, account, inherited metadata, platform defaults) is derived by the
  // ai_ops_social_prepare_publication BEFORE INSERT trigger. Do not set those fields here.
  const insertRow: Record<string, unknown> = {
    source_type: params.sourceType,
    delivery_mode: deliveryMode,
  };
  if (params.sourceType === "clip") insertRow.clip_id = sourceId;
  else insertRow.project_id = sourceId;
  if (scheduledFor) {
    insertRow.scheduled_for = scheduledFor;
    insertRow.desired_privacy_status = "public";
  }

  const { data, error } = await auth.db
    .from("ai_operations_social_publications")
    .insert(insertRow)
    .select("id, tenant_id")
    .single();
  if (error) throw new Error(error.message);
  if (data.tenant_id !== auth.tenantId) {
    // Unreachable after the ownership check; kept so a future trigger change can never
    // silently hand another tenant's publication back to this caller.
    await auth.db.from("ai_operations_social_publications").delete().eq("id", data.id as string);
    throw new Error(SOURCE_NOT_FOUND);
  }
  return getPublication(auth, { id: data.id as string });
}

const EDITABLE_FIELDS = [
  "title", "description", "tags", "hashtags", "category_id", "category_name",
  "default_language", "license", "made_for_kids", "contains_synthetic_media",
  "embeddable", "public_stats_viewable", "notify_subscribers",
  "thumbnail_file_id", "thumbnail_url", "desired_privacy_status",
  "delivery_mode", "scheduled_for",
] as const;
const camelToSnake: Record<string, string> = Object.fromEntries(
  EDITABLE_FIELDS.map((field) => [field.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), field]),
);

export async function updatePublication(auth: AuthContext, params: { id: string; changes: Record<string, unknown> }) {
  const current = await loadPublication(auth, params.id);
  const status = String(current.status) as PublicationStatus;
  if (LOCKED_STATUSES.has(status) || status === "cancelled" || status === "failed") {
    throw new Error(`Publication metadata is locked while status is "${current.status}"`);
  }

  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params.changes ?? {})) {
    const column = camelToSnake[key];
    if (column) patch[column] = value;
  }
  if (Object.keys(patch).length === 0) return getPublication(auth, { id: params.id });
  if (patch.delivery_mode === "scheduled" || (patch.scheduled_for !== undefined && patch.scheduled_for !== null)) {
    const nextSchedule = patch.scheduled_for !== undefined ? patch.scheduled_for : current.scheduled_for;
    patch.scheduled_for = normalizeFutureSchedule(nextSchedule);
  }

  // Editing after approval clears the approval so a stale-but-approved snapshot can't be queued.
  if (status === "approved") {
    assertTransition(status, "ready");
    Object.assign(patch, { status: "ready", approved_at: null, approved_by: null });
  }

  const { data, error } = await auth.db
    .from("ai_operations_social_publications")
    .update(patch)
    .eq("id", params.id)
    .eq("tenant_id", auth.tenantId)
    .eq("status", status)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("Publication changed while saving; reload and try again.");
  return getPublication(auth, { id: params.id });
}

export async function validatePublication(auth: AuthContext, params: { id: string }): Promise<ValidationResult> {
  const row = await loadPublication(auth, params.id);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!row.title || String(row.title).trim().length === 0) errors.push("Title is required.");
  if (!["public", "unlisted", "private"].includes(String(row.desired_privacy_status))) errors.push("Visibility is invalid.");
  if (row.delivery_mode === "scheduled" && !row.scheduled_for) {
    errors.push("A scheduled publish time is required.");
  } else if (row.delivery_mode === "scheduled") {
    const scheduledMs = Date.parse(String(row.scheduled_for));
    if (!Number.isFinite(scheduledMs) || scheduledMs <= Date.now() + MIN_SCHEDULE_LEAD_MS) {
      errors.push("Scheduled publish time must be at least 1 minute in the future.");
    }
    if (row.content_format === "short" && !row.thumbnail_file_id) {
      errors.push("Choose a thumbnail before scheduling this Short so it is ready for the manual YouTube Studio step.");
    }
  }

  if (row.source_type === "clip") {
    const { data: clip, error: clipError } = await auth.db
      .from("ai_operations_video_clips")
      .select("clip_type, drive_file_id, end_seconds, start_seconds, status")
      .eq("id", row.clip_id as string)
      .maybeSingle();
    if (clipError || !clip) errors.push("Source clip could not be found.");
    else {
      if (!clip.drive_file_id) errors.push("Rendered clip file is not available in Drive.");
      const expectedFormat = clip.clip_type === "short" ? "short" : "long_form";
      if (expectedFormat !== row.content_format) errors.push(`Clip type "${clip.clip_type}" does not match content format "${row.content_format}".`);
      if (clip.clip_type === "short") {
        const duration = Number(clip.end_seconds) - Number(clip.start_seconds);
        if (duration > 180) warnings.push(`Short duration is ${Math.round(duration)}s, which exceeds YouTube's typical 180s Shorts window.`);

        const { data: renderJob, error: renderError } = await auth.db
          .from("ai_operations_video_jobs")
          .select("payload,status,completed_at")
          .eq("job_type", "render_clip")
          .eq("clip_id", row.clip_id as string)
          .eq("status", "complete")
          .order("completed_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (renderError) errors.push("Could not verify the Short render profile.");
        else {
          const renderPayload = (renderJob?.payload ?? {}) as Record<string, unknown>;
          if (!isVerifiedCurrentShortRender(renderPayload, clip.drive_file_id)) {
            errors.push("Current Short file must have a verified 1080x1920 (9:16) render before approval.");
          }
        }
      }
    }
  } else {
    const { data: project, error: projectError } = await auth.db
      .from("ai_operations_video_projects")
      .select("source_file_id")
      .eq("id", row.project_id as string)
      .eq("tenant_id", auth.tenantId)
      .maybeSingle();
    if (projectError || !project) errors.push("Source project could not be found.");
    else if (!project.source_file_id) errors.push("Source video file is not available.");
  }

  if (row.content_format !== "short" && !row.thumbnail_file_id) warnings.push("No custom thumbnail is set.");
  if (row.content_format === "short" && row.delivery_mode === "scheduled") {
    warnings.push("This Short will upload to YouTube immediately as private with the scheduled public time. Add its thumbnail manually in YouTube Studio before it publishes.");
  }

  const { data: playlistLinks, error: playlistError } = await auth.db
    .from("ai_operations_social_publication_playlists")
    .select("playlist_id, ai_operations_social_playlists!inner(account_id, tenant_id, is_active)")
    .eq("publication_id", params.id);
  if (playlistError) errors.push("Could not verify selected playlists.");
  else {
    for (const link of playlistLinks ?? []) {
      const playlist = link.ai_operations_social_playlists as unknown as { account_id: string; tenant_id: string; is_active: boolean };
      if (playlist.account_id !== row.account_id || playlist.tenant_id !== auth.tenantId) {
        errors.push("A selected playlist does not belong to the configured YouTube account.");
      } else if (!playlist.is_active) {
        errors.push("A selected playlist is no longer active.");
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

export async function approvePublication(auth: AuthContext, params: { id: string }) {
  const current = await loadPublication(auth, params.id);
  assertTransition(String(current.status), "approved");
  const validation = await validatePublication(auth, params);
  if (!validation.ok) throw new Error(`Publication is not ready to approve: ${validation.errors.join(" ")}`);

  const { data, error } = await auth.db
    .from("ai_operations_social_publications")
    .update({ status: "approved", approved_at: new Date().toISOString(), approved_by: auth.userId || null })
    .eq("id", params.id)
    .eq("tenant_id", auth.tenantId)
    .in("status", ["draft", "ready"])
    .select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("Publication changed while approving; reload and try again.");
  return getPublication(auth, { id: params.id });
}

export async function queuePublish(auth: AuthContext, params: { id: string }) {
  // social_queue_publish runs as the service role and is not tenant-aware: prove ownership first.
  const current = await loadPublication(auth, params.id);
  assertTransition(String(current.status), "upload_queued");
  const { data, error } = await auth.db.rpc("social_queue_publish", { p_publication_id: params.id });
  if (error) throw new Error(error.message);
  return { jobId: data as number, publication: await getPublication(auth, { id: params.id }) };
}

/**
 * Changes a publication's scheduled time. Before upload this is a CRM-only edit. After
 * upload the video's publishAt lives on YouTube, so YouTube is updated first, read back,
 * and only a verified YouTube schedule is written to the CRM -- the two can never disagree.
 */
export async function reschedulePublication(
  auth: AuthContext,
  params: { id: string; scheduledFor: string },
  youtube: YoutubeScheduleClient,
  nowMs = Date.now(),
) {
  const scheduledFor = normalizeFutureSchedule(params.scheduledFor, nowMs);
  const current = await loadPublication(auth, params.id);
  const status = String(current.status) as PublicationStatus;
  const previous = (current.scheduled_for as string | null) ?? null;

  if (PRE_UPLOAD_RESCHEDULE_STATUSES.includes(status) && !current.external_video_id) {
    const patch: Record<string, unknown> = { delivery_mode: "scheduled", scheduled_for: scheduledFor, desired_privacy_status: "public" };
    // A new time is a material change to what was approved.
    if (status === "approved") Object.assign(patch, { status: "ready", approved_at: null, approved_by: null });
    const { data, error } = await auth.db
      .from("ai_operations_social_publications")
      .update(patch)
      .eq("id", params.id)
      .eq("tenant_id", auth.tenantId)
      .eq("status", status)
      .is("external_video_id", null)
      .select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error("Publication changed while rescheduling; reload and try again.");
    await insertEvent(auth, params.id, "schedule_changed", { from: previous, to: scheduledFor, youtubeUpdated: false });
    return getPublication(auth, { id: params.id });
  }

  if (status !== "scheduled" || !current.external_video_id || current.delivery_mode !== "scheduled") {
    throw new Error(`Cannot reschedule a publication with status "${status}".`);
  }

  const videoId = String(current.external_video_id);
  const before = await youtube.getDeliveryStatus(videoId);
  if (before.privacyStatus !== "private") {
    throw new Error(`YouTube reports this video is already ${before.privacyStatus ?? "unavailable"}; it can no longer be rescheduled.`);
  }

  // Resend the complete status so no other YouTube setting is reset by the update.
  await youtube.updateStatus(videoId, buildYoutubeStatus(current, { privacyStatus: "private", publishAt: scheduledFor }));
  const after = await youtube.getDeliveryStatus(videoId);
  const decision = verifyScheduledDelivery(after, scheduledFor, null, nowMs);
  const checkedAt = new Date(nowMs).toISOString();
  const platformPayload = { ...((current.platform_payload ?? {}) as Record<string, unknown>) };
  platformPayload.youtubeSchedule = {
    apiStatus: decision.state === "verified" ? "verified" : "reschedule_unverified",
    expectedPublishAt: decision.state === "verified" ? scheduledFor : previous,
    requestedPublishAt: scheduledFor,
    youtubePublishAt: after.publishAt,
    privacyStatus: after.privacyStatus,
    uploadStatus: after.uploadStatus,
    processingStatus: after.processingStatus,
    checkedAt,
    reason: "reason" in decision ? decision.reason : null,
  };

  if (decision.state !== "verified") {
    // Leave scheduled_for untouched: the CRM only records a schedule YouTube confirmed.
    await auth.db.from("ai_operations_social_publications").update({
      platform_payload: platformPayload,
      error_code: "reschedule_unverified",
      error_message: `YouTube did not confirm the new publish time. YouTube currently reports publishAt ${after.publishAt ?? "none"} (${after.privacyStatus}).`,
    }).eq("id", params.id).eq("tenant_id", auth.tenantId);
    await insertEvent(auth, params.id, "youtube_reschedule_unverified", {
      from: previous, requested: scheduledFor, youtubePublishAt: after.publishAt, privacyStatus: after.privacyStatus,
    });
    throw new Error(`YouTube did not confirm the new publish time (YouTube reports ${after.publishAt ?? "no publish time"}). Check the video in YouTube Studio.`);
  }

  const reconciliationCode = String(current.error_code ?? "");
  const { data, error } = await auth.db
    .from("ai_operations_social_publications")
    .update({
      scheduled_for: scheduledFor,
      platform_payload: platformPayload,
      platform_upload_status: after.uploadStatus,
      platform_processing_status: after.processingStatus,
      ...(reconciliationCode.startsWith("reconcile_") || reconciliationCode.startsWith("reschedule_")
        ? { error_code: null, error_message: null } : {}),
    })
    .eq("id", params.id)
    .eq("tenant_id", auth.tenantId)
    .eq("status", "scheduled")
    .select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("YouTube was rescheduled, but the publication changed state meanwhile; reload to see the reconciled state.");
  await insertEvent(auth, params.id, "youtube_rescheduled", {
    from: previous, to: scheduledFor, youtubePublishAt: after.publishAt, privacyStatus: after.privacyStatus,
  });
  return getPublication(auth, { id: params.id });
}

/**
 * Cancels a publication that has not reached YouTube. Once a video exists on YouTube a
 * CRM-only cancel would be a false statement, so it is refused with instructions instead.
 */
export async function cancelPublication(auth: AuthContext, params: { id: string }) {
  const current = await loadPublication(auth, params.id);
  const status = String(current.status) as PublicationStatus;
  if (current.external_video_id) {
    throw new Error(
      `This video already exists on YouTube (${current.external_video_id}). Cancelling it in the CRM would not unschedule or remove it -- ` +
      "change its visibility or delete it in YouTube Studio.",
    );
  }
  if (!CANCELLABLE_STATUSES.includes(status)) {
    throw new Error(status === "uploading"
      ? "An upload to YouTube is in progress and cannot be cancelled safely. Wait for it to finish, then handle the video in YouTube Studio."
      : `A publication with status "${status}" cannot be cancelled.`);
  }

  // Cancel the publication first with a state guard: if the worker claimed it in the
  // meantime this updates nothing and the job is left alone.
  const { data, error } = await auth.db
    .from("ai_operations_social_publications")
    .update({ status: "cancelled" })
    .eq("id", params.id)
    .eq("tenant_id", auth.tenantId)
    .in("status", [...CANCELLABLE_STATUSES])
    .is("external_video_id", null)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("The publication started uploading before it could be cancelled.");

  const { error: jobError } = await auth.db
    .from("ai_operations_video_jobs")
    .update({ status: "cancelled", claimed_by: null, claimed_at: null })
    .eq("social_publication_id", params.id)
    .eq("tenant_id", auth.tenantId)
    .in("status", ["queued", "claimed", "running"]);
  if (jobError) throw new Error(jobError.message);
  return getPublication(auth, { id: params.id });
}

export async function retryPublication(auth: AuthContext, params: { id: string }) {
  const current = await loadPublication(auth, params.id);
  if (current.status !== "failed") throw new Error(`Only failed publications can be retried (current status: ${current.status})`);
  assertTransition("failed", "approved");

  const { data, error } = await auth.db
    .from("ai_operations_social_publications")
    .update({ status: "approved", error_code: null, error_message: null, next_attempt_at: null })
    .eq("id", params.id)
    .eq("tenant_id", auth.tenantId)
    .eq("status", "failed")
    .select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("Publication changed while retrying; reload and try again.");
  return queuePublish(auth, { id: params.id });
}

export async function markThumbnailManualDone(auth: AuthContext, params: { id: string }) {
  const current = await loadPublication(auth, params.id);
  if (current.content_format !== "short") throw new Error("Manual thumbnail confirmation is only used for Shorts.");
  if (!current.external_video_id) throw new Error("This Short has not been uploaded to YouTube yet.");
  if (!["scheduled", "uploaded", "published"].includes(String(current.status))) {
    throw new Error(`Cannot confirm a thumbnail while status is "${current.status}".`);
  }

  const platformPayload = { ...((current.platform_payload ?? {}) as Record<string, unknown>) };
  const existing = platformPayload.thumbnail && typeof platformPayload.thumbnail === "object"
    ? platformPayload.thumbnail as Record<string, unknown> : {};
  const confirmedAt = new Date().toISOString();
  const thumbnail = {
    ...existing,
    apiStatus: "manual_confirmed",
    manualRequired: false,
    manualConfirmedAt: confirmedAt,
    studioUrl: `https://studio.youtube.com/video/${encodeURIComponent(String(current.external_video_id))}/edit`,
  };

  const { error } = await auth.db
    .from("ai_operations_social_publications")
    .update({ platform_payload: { ...platformPayload, thumbnail } })
    .eq("id", params.id)
    .eq("tenant_id", auth.tenantId);
  if (error) throw new Error(error.message);

  await insertEvent(auth, params.id, "thumbnail_manual_confirmed", { confirmedAt });
  return getPublication(auth, { id: params.id });
}

export async function listPublicationEvents(auth: AuthContext, params: { id: string }) {
  await loadPublication(auth, params.id);
  const { data, error } = await auth.db
    .from("ai_operations_social_publication_events")
    .select("*")
    .eq("publication_id", params.id)
    .eq("tenant_id", auth.tenantId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Replaces the non-default playlist selection. Every requested playlist is resolved and
 * must belong to the caller's tenant, to the publication's YouTube account, and be active
 * -- the whole request is rejected before any link is written if one fails.
 */
export async function setPublicationPlaylists(auth: AuthContext, params: { id: string; playlistIds: string[] }) {
  const publication = await loadPublication(auth, params.id);
  const status = String(publication.status) as PublicationStatus;
  if (LOCKED_STATUSES.has(status) || status === "cancelled") {
    throw new Error(`Playlists are locked while status is "${status}".`);
  }
  if (!Array.isArray(params.playlistIds) || params.playlistIds.some((id) => typeof id !== "string")) {
    throw new Error("playlistIds must be an array of playlist ids.");
  }
  const requestedIds = new Set(params.playlistIds);
  if ([...requestedIds].some((id) => !UUID_PATTERN.test(id))) throw new Error(PLAYLIST_NOT_ALLOWED);

  if (requestedIds.size) {
    const { data: playlists, error: playlistError } = await auth.db
      .from("ai_operations_social_playlists")
      .select("id, tenant_id, account_id, is_active")
      .in("id", [...requestedIds]);
    if (playlistError) throw new Error(playlistError.message);
    const byId = new Map((playlists ?? []).map((playlist) => [String(playlist.id), playlist]));
    for (const id of requestedIds) {
      const playlist = byId.get(id);
      if (!playlist || playlist.tenant_id !== auth.tenantId || playlist.account_id !== publication.account_id || !playlist.is_active) {
        throw new Error(PLAYLIST_NOT_ALLOWED);
      }
    }
  }

  const { data: current, error: currentError } = await auth.db
    .from("ai_operations_social_publication_playlists")
    .select("playlist_id, is_default")
    .eq("publication_id", params.id);
  if (currentError) throw new Error(currentError.message);

  // Default playlists attached by routing are never silently dropped here -- removing one
  // requires an explicit override, which is not exposed.
  for (const row of current ?? []) if (row.is_default) requestedIds.add(String(row.playlist_id));

  const toRemove = (current ?? []).filter((row) => !row.is_default && !requestedIds.has(String(row.playlist_id))).map((row) => row.playlist_id);
  const existingIds = new Set((current ?? []).map((row) => String(row.playlist_id)));
  const toAdd = [...requestedIds].filter((id) => !existingIds.has(id));

  if (toRemove.length) {
    const { error } = await auth.db
      .from("ai_operations_social_publication_playlists")
      .delete()
      .eq("publication_id", params.id)
      .in("playlist_id", toRemove);
    if (error) throw new Error(error.message);
  }
  if (toAdd.length) {
    const { error } = await auth.db
      .from("ai_operations_social_publication_playlists")
      .insert(toAdd.map((playlistId) => ({ publication_id: params.id, playlist_id: playlistId, is_default: false })));
    if (error) throw new Error(error.message);
  }
  return getPublication(auth, { id: params.id });
}
