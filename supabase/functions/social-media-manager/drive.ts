import type { SupabaseClient } from "npm:@supabase/supabase-js@2.93.1";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";

/**
 * Same private-Drive access pattern already proven by video-youtube-publish-dispatcher/drive.ts,
 * reimplemented here rather than importing it: that file lives inside a load-bearing dispatcher
 * function directory (not _shared), and the render/publish pipeline must not be touched by a
 * thumbnail feature. Read-only metadata + alt=media byte reads only.
 */
export async function driveAccessToken(db: SupabaseClient): Promise<string> {
  const { data, error } = await db.rpc("get_relationship_google_connection_runtime", {
    p_tenant_id: TENANT_ID,
    p_connection_type: "drive",
    p_connection_id: null,
  });
  if (error) throw new Error(error.message);
  const refreshToken = String((data as Record<string, unknown> | null)?.refreshToken ?? "");
  if (!refreshToken) throw new Error("Google Drive connection is unavailable.");

  const clientId = Deno.env.get("GOOGLE_RELATIONSHIPS_CLIENT_ID") ?? "";
  const clientSecret = Deno.env.get("GOOGLE_RELATIONSHIPS_CLIENT_SECRET") ?? "";
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.access_token) throw new Error("Google Drive token refresh failed.");
  return String(body.access_token);
}

export async function driveFileMetadata(
  accessToken: string,
  fileId: string,
): Promise<{ size: number; mimeType: string; name: string; videoMediaMetadata?: { width?: number | string; height?: number | string; durationMillis?: number | string } }> {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=size,mimeType,name,videoMediaMetadata`;
  const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Drive metadata fetch failed (${response.status}): ${body?.error?.message ?? "unknown error"}`);
  }
  return { size: Number(body.size ?? 0), mimeType: String(body.mimeType ?? ""), name: String(body.name ?? "image") , videoMediaMetadata: body.videoMediaMetadata ?? undefined };
}

export async function driveFileBytes(accessToken: string, fileId: string): Promise<ArrayBuffer> {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`Drive download failed (${response.status}).`);
  return await response.arrayBuffer();
}
