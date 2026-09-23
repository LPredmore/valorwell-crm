import type { AuthContext } from "../auth.ts";
import type { SocialPublication, ValidationResult } from "../types.ts";

const ACTIVE_STATUSES = ["draft", "ready", "approved", "upload_queued", "uploading", "uploaded", "scheduled"];

async function loadPublication(auth: AuthContext, id: string) {
  const { data, error } = await auth.db
    .from("ai_operations_social_publications")
    .select("*, ai_operations_social_publication_playlists(playlist_id, is_default, ai_operations_social_playlists(display_name))")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Publication not found");
  return data;
}

function toApiShape(row: Record<string, unknown>): SocialPublication {
  const playlists = (row.ai_operations_social_publication_playlists as Array<Record<string, unknown>> ?? []).map((link) => ({
    playlistId: String(link.playlist_id),
    displayName: String((link.ai_operations_social_playlists as Record<string, unknown> | null)?.display_name ?? ""),
    isDefault: Boolean(link.is_default),
  }));
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
    thumbnailDelivery: ((row.platform_payload as Record<string, unknown> | null)?.thumbnail as
      { apiStatus: string; error: string | null; attemptedAt: string | null } | undefined) ?? null,
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
    .select("*, ai_operations_social_publication_playlists(playlist_id, is_default, ai_operations_social_playlists(display_name))")
    .eq("tenant_id", auth.tenantId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (params.status) query = query.eq("status", params.status);
  if (params.scheduledOnly) query = query.not("scheduled_for", "is", null);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => toApiShape(row as Record<string, unknown>));
}

export async function getPublication(auth: AuthContext, params: { id: string }) {
  const row = await loadPublication(auth, params.id);
  return toApiShape(row as Record<string, unknown>);
}

export async function createPublication(
  auth: AuthContext,
  params: { sourceType: "clip" | "project"; clipId?: string; projectId?: string; deliveryMode?: "immediate" | "scheduled"; scheduledFor?: string },
) {
  if (params.sourceType === "clip" && !params.clipId) throw new Error("clipId is required for source_type=clip");
  if (params.sourceType === "project" && !params.projectId) throw new Error("projectId is required for source_type=project");

  const existingQuery = auth.db
    .from("ai_operations_social_publications")
    .select("id")
    .eq("tenant_id", auth.tenantId)
    .in("status", ACTIVE_STATUSES);
  const { data: existing, error: existingError } = params.sourceType === "clip"
    ? await existingQuery.eq("clip_id", params.clipId as string)
    : await existingQuery.eq("project_id", params.projectId as string).eq("content_format", "full_episode").is("clip_id", null);
  if (existingError) throw new Error(existingError.message);
  if (existing?.length) throw new Error("An active publication already exists for this source");

  // Only source identity and schedule are passed -- everything else (tenant, project, content
  // format, account, inherited metadata, platform defaults) is derived by the
  // ai_ops_social_prepare_publication BEFORE INSERT trigger. Do not set those fields here.
  const insertRow: Record<string, unknown> = {
    source_type: params.sourceType,
    delivery_mode: params.deliveryMode ?? "immediate",
  };
  if (params.sourceType === "clip") insertRow.clip_id = params.clipId;
  else insertRow.project_id = params.projectId;
  if (params.deliveryMode === "scheduled") {
    if (!params.scheduledFor) throw new Error("scheduledFor is required when deliveryMode=scheduled");
    insertRow.scheduled_for = params.scheduledFor;
    insertRow.desired_privacy_status = "public";
  }

  const { data, error } = await auth.db
    .from("ai_operations_social_publications")
    .insert(insertRow)
    .select("id")
    .single();
  if (error) throw new Error(error.message);
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

const LOCKED_STATUSES = new Set(["upload_queued", "uploading", "uploaded", "scheduled", "published"]);

export async function updatePublication(auth: AuthContext, params: { id: string; changes: Record<string, unknown> }) {
  const current = await loadPublication(auth, params.id);
  if (LOCKED_STATUSES.has(String(current.status))) {
    throw new Error(`Publication metadata is locked while status is "${current.status}"`);
  }

  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params.changes ?? {})) {
    const column = camelToSnake[key];
    if (column) patch[column] = value;
  }
  if (Object.keys(patch).length === 0) return toApiShape(current as Record<string, unknown>);

  // Editing after approval clears the approval so a stale-but-approved snapshot can't be queued.
  if (current.status === "approved") patch.status = "ready";

  const { error } = await auth.db
    .from("ai_operations_social_publications")
    .update(patch)
    .eq("id", params.id)
    .eq("tenant_id", auth.tenantId);
  if (error) throw new Error(error.message);
  return getPublication(auth, { id: params.id });
}

export async function validatePublication(auth: AuthContext, params: { id: string }): Promise<ValidationResult> {
  const row = await loadPublication(auth, params.id) as Record<string, unknown>;
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!row.title || String(row.title).trim().length === 0) errors.push("Title is required.");
  if (!["public", "unlisted", "private"].includes(String(row.desired_privacy_status))) errors.push("Visibility is invalid.");
  if (row.delivery_mode === "scheduled" && !row.scheduled_for) errors.push("A scheduled publish time is required.");

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
          const width = Number(renderPayload.render_width ?? 0);
          const height = Number(renderPayload.render_height ?? 0);
          const profile = String(renderPayload.render_profile ?? "");
          if (String(renderPayload.drive_file_id ?? "") !== String(clip.drive_file_id ?? "") || profile !== "youtube_short_9x16" || width !== 1080 || height !== 1920) {
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
      .maybeSingle();
    if (projectError || !project) errors.push("Source project could not be found.");
    else if (!project.source_file_id) errors.push("Source video file is not available.");
  }

  if (row.content_format !== "short" && !row.thumbnail_file_id) warnings.push("No custom thumbnail is set.");

  const { data: playlistLinks, error: playlistError } = await auth.db
    .from("ai_operations_social_publication_playlists")
    .select("playlist_id, ai_operations_social_playlists!inner(account_id)")
    .eq("publication_id", params.id);
  if (playlistError) errors.push("Could not verify selected playlists.");
  else {
    for (const link of playlistLinks ?? []) {
      const playlistAccountId = (link.ai_operations_social_playlists as unknown as { account_id: string }).account_id;
      if (playlistAccountId !== row.account_id) errors.push("A selected playlist does not belong to the configured YouTube account.");
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

export async function approvePublication(auth: AuthContext, params: { id: string }) {
  const validation = await validatePublication(auth, params);
  if (!validation.ok) throw new Error(`Publication is not ready to approve: ${validation.errors.join(" ")}`);

  const { error } = await auth.db
    .from("ai_operations_social_publications")
    .update({ status: "approved", approved_at: new Date().toISOString(), approved_by: auth.userId })
    .eq("id", params.id)
    .eq("tenant_id", auth.tenantId)
    .in("status", ["draft", "ready"]);
  if (error) throw new Error(error.message);
  return getPublication(auth, { id: params.id });
}

export async function queuePublish(auth: AuthContext, params: { id: string }) {
  const { data, error } = await auth.db.rpc("social_queue_publish", { p_publication_id: params.id });
  if (error) throw new Error(error.message);
  return { jobId: data as number, publication: await getPublication(auth, { id: params.id }) };
}

export async function reschedulePublication(auth: AuthContext, params: { id: string; scheduledFor: string }) {
  const current = await loadPublication(auth, params.id) as Record<string, unknown>;
  if (current.status !== "scheduled" && current.status !== "draft" && current.status !== "ready") {
    throw new Error(`Cannot reschedule a publication with status "${current.status}" from the CRM yet -- it may already be live on YouTube.`);
  }
  const { error } = await auth.db
    .from("ai_operations_social_publications")
    .update({ delivery_mode: "scheduled", scheduled_for: params.scheduledFor, desired_privacy_status: "public" })
    .eq("id", params.id)
    .eq("tenant_id", auth.tenantId);
  if (error) throw new Error(error.message);
  return getPublication(auth, { id: params.id });
}

export async function cancelPublication(auth: AuthContext, params: { id: string }) {
  const current = await loadPublication(auth, params.id) as Record<string, unknown>;
  if (["uploaded", "scheduled", "published"].includes(String(current.status))) {
    throw new Error(`Cancelling a publication with status "${current.status}" from the CRM is not supported yet -- it may already be live on YouTube.`);
  }
  const { error: jobError } = await auth.db
    .from("ai_operations_video_jobs")
    .update({ status: "cancelled" })
    .eq("social_publication_id", params.id)
    .in("status", ["queued", "claimed", "running"]);
  if (jobError) throw new Error(jobError.message);

  const { error } = await auth.db
    .from("ai_operations_social_publications")
    .update({ status: "cancelled" })
    .eq("id", params.id)
    .eq("tenant_id", auth.tenantId);
  if (error) throw new Error(error.message);
  return getPublication(auth, { id: params.id });
}

export async function retryPublication(auth: AuthContext, params: { id: string }) {
  const current = await loadPublication(auth, params.id) as Record<string, unknown>;
  if (current.status !== "failed") throw new Error(`Only failed publications can be retried (current status: ${current.status})`);

  const { error } = await auth.db
    .from("ai_operations_social_publications")
    .update({ status: "approved", error_code: null, error_message: null })
    .eq("id", params.id)
    .eq("tenant_id", auth.tenantId);
  if (error) throw new Error(error.message);
  return queuePublish(auth, { id: params.id });
}

export async function listPublicationEvents(auth: AuthContext, params: { id: string }) {
  const { data, error } = await auth.db
    .from("ai_operations_social_publication_events")
    .select("*")
    .eq("publication_id", params.id)
    .eq("tenant_id", auth.tenantId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function setPublicationPlaylists(auth: AuthContext, params: { id: string; playlistIds: string[] }) {
  await loadPublication(auth, params.id);
  const { data: current, error: currentError } = await auth.db
    .from("ai_operations_social_publication_playlists")
    .select("playlist_id, is_default")
    .eq("publication_id", params.id);
  if (currentError) throw new Error(currentError.message);

  const defaultIds = new Set((current ?? []).filter((row) => row.is_default).map((row) => row.playlist_id));
  const requestedIds = new Set(params.playlistIds);
  // Default playlists set by the auto-attach trigger are never silently dropped here --
  // removing one requires an explicit override, which isn't wired up in this phase.
  for (const id of defaultIds) requestedIds.add(id);

  const toRemove = (current ?? []).filter((row) => !row.is_default && !requestedIds.has(row.playlist_id)).map((row) => row.playlist_id);
  const existingIds = new Set((current ?? []).map((row) => row.playlist_id));
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
