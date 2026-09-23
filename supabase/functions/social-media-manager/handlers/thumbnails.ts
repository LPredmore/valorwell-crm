import type { AuthContext } from "../auth.ts";
import { driveAccessToken, driveFileBytes, driveFileMetadata } from "../drive.ts";

export const THUMBNAIL_BUCKET = "social-media-thumbnails";
export const ALLOWED_THUMBNAIL_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const MAX_THUMBNAIL_BYTES = 10 * 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 3600;

export type ThumbnailRequest = { sourceType?: unknown; sourceId?: unknown };
export type ThumbnailResult = { fileId: string | null; signedUrl: string | null; expiresInSeconds: number | null };

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/**
 * Deterministic, version-specific cache key. The Drive file id is the version identifier:
 * a replaced cover gets a new file id and therefore a new object, so a stale cached image
 * can never be served, and re-requests for an unchanged cover never re-download.
 */
export function thumbnailCachePath(
  tenantId: string,
  sourceType: "clip" | "project",
  sourceId: string,
  fileId: string,
  extension: string,
): string {
  return `${tenantId}/${sourceType}/${sourceId}/${fileId}.${extension}`;
}

/**
 * Resolves the Drive file id from the caller's own tenant-scoped record. The browser only
 * ever names a source row -- an arbitrary Google file id or storage path from the request
 * body is never trusted or used.
 */
async function resolveSourceFileId(
  auth: AuthContext,
  sourceType: "clip" | "project",
  sourceId: string,
): Promise<string | null> {
  const { db, tenantId } = auth;

  if (sourceType === "clip") {
    const { data, error } = await db
      .from("ai_operations_video_clips")
      .select("id, cover_image_file_id, ai_operations_video_projects!inner(tenant_id)")
      .eq("id", sourceId)
      .eq("ai_operations_video_projects.tenant_id", tenantId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("NOT_FOUND");
    return (data as { cover_image_file_id: string | null }).cover_image_file_id ?? null;
  }

  const { data, error } = await db
    .from("ai_operations_video_projects")
    .select("id, cover_image_file_id")
    .eq("id", sourceId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("NOT_FOUND");
  // Deliberately no fallback to the guest portrait field: a guest photo is not an episode cover.
  return (data as { cover_image_file_id: string | null }).cover_image_file_id ?? null;
}

export async function getThumbnailUrl(auth: AuthContext, params: ThumbnailRequest): Promise<ThumbnailResult> {
  const sourceType = params.sourceType === "clip" || params.sourceType === "project" ? params.sourceType : null;
  const sourceId = typeof params.sourceId === "string" ? params.sourceId.trim() : "";
  if (!sourceType || !sourceId) throw new Error("INVALID_PARAMS");

  const fileId = await resolveSourceFileId(auth, sourceType, sourceId);
  if (!fileId) return { fileId: null, signedUrl: null, expiresInSeconds: null };

  const { db, tenantId } = auth;
  const storage = db.storage.from(THUMBNAIL_BUCKET);
  const prefix = `${tenantId}/${sourceType}/${sourceId}`;

  // Cache hit: an object whose name starts with the Drive file id already holds these bytes.
  const { data: existing } = await storage.list(prefix, { search: fileId, limit: 5 });
  const cached = existing?.find((entry) => entry.name.startsWith(`${fileId}.`));
  if (cached) {
    const path = `${prefix}/${cached.name}`;
    const { data: signed, error: signError } = await storage.createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (!signError && signed?.signedUrl) {
      return { fileId, signedUrl: signed.signedUrl, expiresInSeconds: SIGNED_URL_TTL_SECONDS };
    }
  }

  const accessToken = await driveAccessToken(db);
  const metadata = await driveFileMetadata(accessToken, fileId);
  if (!ALLOWED_THUMBNAIL_MIME_TYPES.includes(metadata.mimeType)) {
    throw new Error(`UNSUPPORTED_IMAGE_TYPE:${metadata.mimeType || "unknown"}`);
  }
  if (metadata.size > MAX_THUMBNAIL_BYTES) throw new Error("IMAGE_TOO_LARGE");

  const bytes = await driveFileBytes(accessToken, fileId);
  if (bytes.byteLength > MAX_THUMBNAIL_BYTES) throw new Error("IMAGE_TOO_LARGE");

  const path = thumbnailCachePath(tenantId, sourceType, sourceId, fileId, EXTENSION_BY_MIME[metadata.mimeType]);
  // upsert makes two concurrent first-time requests for the same card idempotent instead of
  // one of them failing with a duplicate-object error.
  const { error: uploadError } = await storage.upload(path, bytes, {
    contentType: metadata.mimeType,
    upsert: true,
  });
  if (uploadError) throw new Error(`THUMBNAIL_CACHE_FAILED:${uploadError.message}`);

  const { data: signed, error: signError } = await storage.createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (signError || !signed?.signedUrl) throw new Error("THUMBNAIL_SIGN_FAILED");
  return { fileId, signedUrl: signed.signedUrl, expiresInSeconds: SIGNED_URL_TTL_SECONDS };
}
