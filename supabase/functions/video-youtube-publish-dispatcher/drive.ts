import type { SupabaseClient } from "npm:@supabase/supabase-js@2.93.1";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";

/**
 * Mirrors the Drive access pattern already used by video-drive-media-proxy /
 * video-cloudflare-render-dispatcher, but implemented directly here rather than calling
 * those deployed functions over HTTP -- video-drive-media-proxy only accepts
 * job_type in (transcribe, render_clip) and is load-bearing for the live Cloudflare
 * render pipeline, so it's safer not to extend it for a new, unrelated job type.
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
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.access_token) throw new Error("Google Drive token refresh failed.");
  return String(body.access_token);
}

export async function driveFileMetadata(accessToken: string, fileId: string): Promise<{ size: number; mimeType: string; name: string; videoMediaMetadata?: { width?: number | string; height?: number | string; durationMillis?: number | string } }> {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=size,mimeType,name,videoMediaMetadata`;
  const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Drive metadata fetch failed (${response.status}): ${body?.error?.message ?? "unknown error"}`);
  return { size: Number(body.size ?? 0), mimeType: String(body.mimeType ?? "video/mp4"), name: String(body.name ?? "video") , videoMediaMetadata: body.videoMediaMetadata ?? undefined };
}

/** Fetches an inclusive byte range [start, end] from a Drive file. */
export async function driveFileRange(accessToken: string, fileId: string, start: number, end: number): Promise<ArrayBuffer> {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}`, range: `bytes=${start}-${end}` },
  });
  if (!response.ok && response.status !== 206) {
    throw new Error(`Drive range fetch failed (${response.status}).`);
  }
  return await response.arrayBuffer();
}
