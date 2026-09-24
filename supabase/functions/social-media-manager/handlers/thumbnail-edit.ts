import type { AuthContext } from "../context.ts";
import { driveAccessToken } from "../drive.ts";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const COVER_FOLDER_NAME = "YouTube Cover Images";
const DRIVE_BASE = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const DEFAULT_TENANT = "00000000-0000-0000-0000-000000000001";

type SourceType = "clip" | "project";
type LinkedPublication = {
  id: string;
  status: string;
  external_video_id: string | null;
  platform_payload: Record<string, unknown> | null;
};

function validImageSignature(data: Uint8Array, type: string): boolean {
  if (type === "image/png") return data.length >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => data[index] === byte);
  return type === "image/jpeg" && data.length >= 4 &&
    data[0] === 255 && data[1] === 216 && data[2] === 255;
}

async function driveFolderId(token: string, previousCoverId: string | null): Promise<string> {
  const headers = { authorization: "Bearer " + token };
  // The current cover, when available, is the most reliable way to find its existing folder.
  if (previousCoverId) {
    const response = await fetch(
      DRIVE_BASE + "/" + encodeURIComponent(previousCoverId) + "?fields=id,parents",
      { headers },
    );
    if (response.ok) {
      const metadata = await response.json();
      if (Array.isArray(metadata.parents) && metadata.parents[0]) return String(metadata.parents[0]);
    }
  }

  const q = "name = '" + COVER_FOLDER_NAME.replace(/'/g, "\\'") +
    "' and mimeType = 'application/vnd.google-apps.folder' and trashed = false";
  const response = await fetch(DRIVE_BASE + "?q=" + encodeURIComponent(q) + "&fields=files(id,name)&pageSize=25", { headers });
  if (!response.ok) throw new Error("DRIVE_FOLDER_LOOKUP_FAILED:" + response.status);
  const listing = await response.json();
  const folder = (listing.files ?? []).find((item: { name?: string }) => item.name === COVER_FOLDER_NAME);
  if (!folder?.id) throw new Error("The Google Drive folder 'YouTube Cover Images' could not be found.");
  return String(folder.id);
}

async function uploadToDrive(
  token: string,
  folderId: string,
  file: File,
  bytes: Uint8Array,
  sourceType: SourceType,
  sourceId: string,
): Promise<{ fileId: string; url: string }> {
  const ext = file.type === "image/png" ? "png" : "jpg";
  const name = sourceType + "-" + sourceId + "-cover-" + crypto.randomUUID() + "." + ext;
  const boundary = "valorwell-cover-" + crypto.randomUUID();
  const metadata = { name, parents: [folderId], mimeType: file.type };
  const parts: BlobPart[] = [
    "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n",
    JSON.stringify(metadata),
    "\r\n--" + boundary + "\r\nContent-Type: " + file.type + "\r\n\r\n",
    bytes as Uint8Array<ArrayBuffer>,
    "\r\n--" + boundary + "--\r\n",
  ];
  const response = await fetch(DRIVE_UPLOAD + "?uploadType=multipart&fields=id,name,webViewLink", {
    method: "POST",
    headers: {
      authorization: "Bearer " + token,
      "content-type": "multipart/related; boundary=" + boundary,
    },
    body: new Blob(parts),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.id) {
    throw new Error("DRIVE_COVER_UPLOAD_FAILED:" + (body?.error?.message ?? String(response.status)));
  }
  const fileId = String(body.id);
  return {
    fileId,
    url: "https://drive.google.com/file/d/" + encodeURIComponent(fileId) + "/view",
  };
}

/** Mutate a tenant-scoped library cover, not the entire video or publishing status.
 * This is called only after the CRM JWT/capability checks in social-media-manager/index.ts.
 */
export async function replaceLibraryThumbnail(auth: AuthContext, params: Record<string, unknown>) {
  const sourceType: SourceType | null = params.sourceType === "clip" || params.sourceType === "project"
    ? params.sourceType : null;
  const sourceId = typeof params.sourceId === "string" ? params.sourceId.trim() : "";
  const file = params.file;
  const updateYoutube = params.updateYouTube === true || params.updateYouTube === "true";
  const targetPublishedId = typeof params.publishedPublicationId === "string" ? params.publishedPublicationId : "";
  if (!sourceType || !/^[a-f0-9-]{36}$/i.test(sourceId) || !(file instanceof File)) {
    throw new Error("INVALID_THUMBNAIL_REQUEST");
  }
  if (auth.tenantId !== DEFAULT_TENANT) {
    // The existing CRM Drive OAuth runtime is configured for the default tenant only.
    throw new Error("DRIVE_NOT_CONFIGURED_FOR_TENANT");
  }
  if (!["image/jpeg", "image/png"].includes(file.type)) {
    throw new Error("Upload a JPG or PNG image.");
  }
  if (!file.size || file.size > MAX_FILE_BYTES) {
    throw new Error("Thumbnail must be 2 MB or less.");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!validImageSignature(bytes, file.type)) throw new Error("INVALID_IMAGE_FILE");

  const { db, tenantId } = auth;
  const table = sourceType === "clip" ? "ai_operations_video_clips" : "ai_operations_video_projects";
  const query = sourceType === "clip"
    ? db.from(table)
      .select("id,project_id,cover_image_file_id,ai_operations_video_projects!inner(tenant_id)")
      .eq("id", sourceId).eq("ai_operations_video_projects.tenant_id", tenantId)
    : db.from(table).select("id,cover_image_file_id").eq("id", sourceId).eq("tenant_id", tenantId);
  const { data: source, error: sourceError } = await query.maybeSingle();
  if (sourceError) throw new Error(sourceError.message);
  if (!source) throw new Error("Source video not found in your CRM tenant.");

  let pubQuery = db.from("ai_operations_social_publications")
    .select("id,status,external_video_id,platform_payload")
    .eq("tenant_id", tenantId).eq("source_type", sourceType);
  pubQuery = sourceType === "clip" ? pubQuery.eq("clip_id", sourceId) :
    pubQuery.eq("project_id", sourceId).is("clip_id", null);
  const { data: pubs, error: pubError } = await pubQuery;
  if (pubError) throw new Error(pubError.message);
  const linked = (pubs ?? []) as LinkedPublication[];
  if (updateYoutube && !linked.some((p) => p.id === targetPublishedId && p.external_video_id && ["published", "uploaded", "scheduled"].includes(p.status))) {
    throw new Error("Select a published video before requesting a YouTube thumbnail update.");
  }
  if (linked.some((p) => p.status === "uploading" || p.status === "upload_queued")) {
    throw new Error("Wait for the current upload to finish before replacing its cover.");
  }

  const projectId = sourceType === "clip" ? String((source as unknown as { project_id: string }).project_id) : sourceId;

  const token = await driveAccessToken(db);
  const folderId = await driveFolderId(token, (source as { cover_image_file_id: string | null }).cover_image_file_id);
  const cover = await uploadToDrive(token, folderId, file, bytes, sourceType, sourceId);

  const { error: sourceUpdateError } = await db.from(table).update({
    cover_image_file_id: cover.fileId,
    cover_image_url: cover.url,
  }).eq("id", sourceId);
  if (sourceUpdateError) throw new Error("COVER_SAVE_FAILED:" + sourceUpdateError.message);

  // Preserve the thumbnail snapshot for already published videos unless the
  // operator explicitly requested updating that exact live YouTube publication.
  const editableIds = linked.filter((p) => ["draft", "ready", "approved"].includes(p.status))
    .map((p) => p.id);
  if (updateYoutube && targetPublishedId) editableIds.push(targetPublishedId);
  if (editableIds.length) {
    const { error: pubUpdateError } = await db.from("ai_operations_social_publications").update({
      thumbnail_file_id: cover.fileId,
      thumbnail_url: cover.url,
    }).in("id", editableIds).eq("tenant_id", tenantId);
    if (pubUpdateError) {
      throw new Error("Cover saved to Library, but associated publications need attention: " + pubUpdateError.message);
    }
  }

  // New artwork must receive fresh approval if it had already been approved but not queued.
  const approvedIds = linked.filter((p) => p.status === "approved").map((p) => p.id);
  if (approvedIds.length) {
    const { error: resetError } = await db.from("ai_operations_social_publications").update({
      status: "ready", approved_at: null, approved_by: null,
    }).in("id", approvedIds).eq("tenant_id", tenantId);
    if (resetError) throw new Error("Cover replaced, but approval reset failed: " + resetError.message);
  }

  let youtubeQueued = 0;
  const warnings: string[] = [];
  if (updateYoutube) {
    const published = linked.filter((p) => p.id === targetPublishedId && p.external_video_id &&
      ["published", "uploaded", "scheduled"].includes(p.status));
    for (const pub of published) {
      const { error: jobError } = await db.from("ai_operations_video_jobs").insert({
        tenant_id: tenantId,
        project_id: projectId,
        clip_id: sourceType === "clip" ? sourceId : null,
        social_publication_id: pub.id,
        job_type: "publish_youtube",
        status: "queued",
        payload: {
          thumbnail_only: true,
          thumbnail_file_id: cover.fileId,
          source: "crm_library_cover_editor",
        },
      });
      if (jobError) {
        warnings.push("Could not queue a YouTube thumbnail refresh: " + jobError.message);
      } else {
        youtubeQueued += 1;
        const { error: stateError } = await db.from("ai_operations_social_publications").update({
          platform_payload: {
            ...(pub.platform_payload ?? {}),
            thumbnail: { apiStatus: "queued", fileId: cover.fileId, attemptedAt: null, error: null },
          },
        }).eq("id", pub.id).eq("tenant_id", tenantId);
        if (stateError) warnings.push("YouTube update queued, but its status display may be delayed.");
      }
    }
  }
  return {
    fileId: cover.fileId, thumbnailUrl: cover.url,
    youtubeQueued, warnings,
    message: youtubeQueued ? "Cover saved; YouTube thumbnail update queued." : "Cover saved to Library.",
  };
}
