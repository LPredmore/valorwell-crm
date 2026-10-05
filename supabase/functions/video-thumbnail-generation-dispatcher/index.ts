import "jsr:@supabase/functions-js@2.4.5/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.93.1";
import {
  Drawables,
  ImageMagick,
  initializeImageMagick,
  Magick,
  MagickColor,
  MagickFormat,
} from "npm:@imagemagick/magick-wasm@0.0.40";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const MODEL = "openai/gpt-image-2.5-sunburst";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/images";
const FONT_NAME = "Anton-Regular.ttf";
const FONT_URL = "https://raw.githubusercontent.com/google/fonts/main/ofl/anton/Anton-Regular.ttf";
const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;
const TARGET_WIDTH = 1280;
const TARGET_HEIGHT = 720;

const wasmBytes = await Deno.readFile(
  new URL("magick.wasm", import.meta.resolve("npm:@imagemagick/magick-wasm@0.0.40")),
);
await initializeImageMagick(wasmBytes);

let fontPromise: Promise<void> | null = null;

type Placement =
  | "top_left"
  | "top_right"
  | "left"
  | "right"
  | "bottom_left"
  | "bottom_right"
  | "center";

type JobRow = {
  id: number;
  project_id: string;
  clip_id: string;
  attempts: number;
  payload: Record<string, unknown> | null;
};

type ClipRow = {
  id: string;
  project_id: string;
  hook_text: string;
  primary_speaker: string;
  person_positioning: string;
  facial_expression: string;
  gesture_action: string;
  camera_framing: string;
  pose_family: string;
  core_visual: string;
  hook_text_placement: Placement;
  thumbnail_generation_revision: number;
  cover_image_file_id: string | null;
};

type ProjectRow = {
  id: string;
  tenant_id: string;
  guest_name: string | null;
  guest_image_url: string | null;
  source_file_name: string;
};

type SettingsRow = {
  cover_image_folder_id: string | null;
  host_reference_name: string | null;
  host_reference_file_id: string | null;
  host_reference_url: string | null;
};

class ThumbnailError extends Error {
  code: string;
  retryable: boolean;
  detail: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    retryable = true,
    detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ThumbnailError";
    this.code = code;
    this.retryable = retryable;
    this.detail = detail;
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function adminClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) throw new Error("Supabase service runtime is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function authorizeWorker(request: Request): boolean {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authorization = request.headers.get("authorization") ?? "";
  if (serviceKey && authorization === \`Bearer \${serviceKey}\`) return true;
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  return Boolean(cronSecret) && request.headers.get("x-cron-secret") === cronSecret;
}

function log(event: string, detail: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ component: "video-thumbnail-generation-dispatcher", event, ...detail }));
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function ensureFont(): Promise<void> {
  if (!fontPromise) {
    fontPromise = (async () => {
      const response = await fetch(FONT_URL, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) {
        throw new ThumbnailError(
          "font_download_failed",
          \`Thumbnail font download failed (\${response.status}).\`,
          true,
        );
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!bytes.length) throw new ThumbnailError("font_empty", "Thumbnail font was empty.", true);
      Magick.addFont(FONT_NAME, bytes);
    })().catch((error) => {
      fontPromise = null;
      throw error;
    });
  }
  await fontPromise;
}

async function googleAccessToken(db: SupabaseClient): Promise<string> {
  const { data, error } = await db.rpc("get_relationship_google_connection_runtime", {
    p_tenant_id: TENANT_ID,
    p_connection_type: "drive",
    p_connection_id: null,
  });
  if (error) throw new ThumbnailError("drive_connection_query_failed", error.message, true);
  const refreshToken = String((data as Record<string, unknown> | null)?.refreshToken ?? "");
  if (!refreshToken) {
    throw new ThumbnailError("drive_connection_missing", "Google Drive connection is unavailable.", false);
  }

  const clientId = Deno.env.get("GOOGLE_RELATIONSHIPS_CLIENT_ID") ?? "";
  const clientSecret = Deno.env.get("GOOGLE_RELATIONSHIPS_CLIENT_SECRET") ?? "";
  if (!clientId || !clientSecret) {
    throw new ThumbnailError("drive_oauth_config_missing", "Google Drive OAuth client is not configured.", false);
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.access_token) {
    throw new ThumbnailError(
      "drive_token_refresh_failed",
      \`Google Drive token refresh failed (\${response.status}).\`,
      response.status >= 500 || response.status === 429,
      { googleError: body?.error ?? null },
    );
  }
  return String(body.access_token);
}

async function driveFileMetadata(
  accessToken: string,
  fileId: string,
): Promise<{ mimeType: string; size: number; name: string }> {
  const response = await fetch(
    \`https://www.googleapis.com/drive/v3/files/\${encodeURIComponent(fileId)}?fields=id,name,mimeType,size\`,
    {
      headers: { authorization: \`Bearer \${accessToken}\` },
      signal: AbortSignal.timeout(20_000),
    },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ThumbnailError(
      "drive_metadata_failed",
      \`Drive metadata fetch failed (\${response.status}): \${body?.error?.message ?? "unknown error"}\`,
      response.status === 429 || response.status >= 500,
    );
  }
  return {
    mimeType: String(body.mimeType ?? ""),
    size: Number(body.size ?? 0),
    name: String(body.name ?? "reference-image"),
  };
}

async function driveFileBytes(accessToken: string, fileId: string): Promise<Uint8Array> {
  const response = await fetch(
    \`https://www.googleapis.com/drive/v3/files/\${encodeURIComponent(fileId)}?alt=media\`,
    {
      headers: { authorization: \`Bearer \${accessToken}\` },
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    throw new ThumbnailError(
      "drive_download_failed",
      \`Drive image download failed (\${response.status}).\`,
      response.status === 429 || response.status >= 500,
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length) throw new ThumbnailError("reference_empty", "Reference image was empty.", false);
  if (bytes.byteLength > MAX_REFERENCE_BYTES) {
    throw new ThumbnailError("reference_too_large", "Reference image exceeds 10 MB.", false);
  }
  return bytes;
}

function parseDriveFileId(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const direct = trimmed.match(/\/file\/d\/([^/?#]+)/i);
  if (direct?.[1]) return direct[1];
  try {
    const url = new URL(trimmed);
    const id = url.searchParams.get("id");
    return id?.trim() || null;
  } catch {
    return null;
  }
}

async function publicImageBytes(url: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new ThumbnailError(
      "reference_http_failed",
      \`Reference image request failed (\${response.status}).\`,
      response.status === 429 || response.status >= 500,
    );
  }
  const declared = String(response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!declared.startsWith("image/")) {
    throw new ThumbnailError("reference_invalid_mime", \`Reference URL returned \${declared || "unknown MIME type"}.\`, false);
  }
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_REFERENCE_BYTES) {
    throw new ThumbnailError("reference_too_large", "Reference image exceeds 10 MB.", false);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length) throw new ThumbnailError("reference_empty", "Reference image was empty.", false);
  if (bytes.byteLength > MAX_REFERENCE_BYTES) {
    throw new ThumbnailError("reference_too_large", "Reference image exceeds 10 MB.", false);
  }
  return { bytes, mimeType: declared };
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const output = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) output[i] = binary.charCodeAt(i);
  return output;
}

function normalizeReference(bytes: Uint8Array): Uint8Array {
  return ImageMagick.read(bytes, (image): Uint8Array => {
    const longest = Math.max(image.width, image.height);
    if (longest > 1600) {
      const scale = 1600 / longest;
      image.resize(
        Math.max(1, Math.round(image.width * scale)),
        Math.max(1, Math.round(image.height * scale)),
      );
    }
    image.quality = 90;
    return image.write(MagickFormat.Jpeg, (data) => new Uint8Array(data));
  });
}

async function resolveReference(
  db: SupabaseClient,
  clip: ClipRow,
  project: ProjectRow,
  settings: SettingsRow,
): Promise<{ bytes: Uint8Array; mimeType: string; source: string }> {
  const speaker = clip.primary_speaker.trim().toLowerCase();
  const isLuke = speaker === "luke" || speaker === "luke predmore";

  if (isLuke) {
    const fileId = settings.host_reference_file_id?.trim() ?? "";
    if (!fileId) {
      throw new ThumbnailError("host_reference_missing", "Luke reference image is not configured.", false);
    }
    const token = await googleAccessToken(db);
    const metadata = await driveFileMetadata(token, fileId);
    if (!metadata.mimeType.startsWith("image/")) {
      throw new ThumbnailError("host_reference_invalid", "Luke reference file is not an image.", false);
    }
    const bytes = normalizeReference(await driveFileBytes(token, fileId));
    return { bytes, mimeType: "image/jpeg", source: \`drive:\${fileId}\` };
  }

  if ((project.guest_name ?? "").trim().toLowerCase() !== speaker) {
    throw new ThumbnailError(
      "speaker_reference_mismatch",
      \`Primary speaker "\${clip.primary_speaker}" does not match Luke or project guest "\${project.guest_name ?? ""}".\`,
      false,
    );
  }

  const guestUrl = project.guest_image_url?.trim() ?? "";
  if (!guestUrl) {
    throw new ThumbnailError("guest_reference_missing", "Guest reference image is not configured.", false);
  }

  const driveId = parseDriveFileId(guestUrl);
  if (driveId) {
    const token = await googleAccessToken(db);
    const metadata = await driveFileMetadata(token, driveId);
    if (!metadata.mimeType.startsWith("image/")) {
      throw new ThumbnailError("guest_reference_invalid", "Guest reference file is not an image.", false);
    }
    const bytes = normalizeReference(await driveFileBytes(token, driveId));
    return { bytes, mimeType: "image/jpeg", source: \`drive:\${driveId}\` };
  }

  const remote = await publicImageBytes(guestUrl);
  return { bytes: normalizeReference(remote.bytes), mimeType: "image/jpeg", source: guestUrl };
}

function placementLanguage(placement: Placement): string {
  const labels: Record<Placement, string> = {
    top_left: "upper-left",
    top_right: "upper-right",
    left: "left side",
    right: "right side",
    bottom_left: "lower-left",
    bottom_right: "lower-right",
    center: "center",
  };
  return labels[placement];
}

function buildPrompt(clip: ClipRow, project: ProjectRow): string {
  const negativeSpace = placementLanguage(clip.hook_text_placement);
  return [
    "Create one finished 16:9 YouTube thumbnail visual. This is the image layer only; typography will be added later by software.",
    "Use the supplied reference image as the identity reference for the primary speaker. Preserve a clearly recognizable likeness while allowing an expressive thumbnail pose.",
    "Aesthetic: high-energy reaction-thumbnail photography, bold and punchy, emotionally intense, strong contrast, clean subject separation, layered depth, dramatic but believable lighting, mobile-first composition, immediately readable at small size.",
    "The primary speaker must dominate the image. Do not make another person the main subject.",
    \`Primary speaker: \${clip.primary_speaker}.\`,
    \`Episode guest/organization context: \${project.guest_name ?? "unknown guest"}.\`,
    \`Core visual: \${clip.core_visual}\`,
    \`Person positioning: \${clip.person_positioning}\`,
    \`Facial expression: \${clip.facial_expression}\`,
    \`Gesture/action: \${clip.gesture_action}\`,
    \`Camera framing: \${clip.camera_framing}\`,
    \`Pose family: \${clip.pose_family}.\`,
    \`Reserve the \${negativeSpace} as clean negative space for a bold text hook that will be overlaid later. Keep the speaker's face and important gesture out of that text-safe region.\`,
    \`The later hook will read exactly: "\${clip.hook_text}". Use its meaning to inform the emotion and scene, but DO NOT render the hook or any other text yourself.\`,
    "Do not render words, letters, numbers, captions, logos, watermarks, title cards, posters, infographics, UI, or readable signage anywhere in the image.",
    "Do not create a full poster. Do not add decorative borders. Keep the composition photographic and entertainment-thumbnail oriented.",
  ].join("\n");
}

async function generateImage(
  apiKey: string,
  prompt: string,
  referenceBytes: Uint8Array,
  referenceMimeType: string,
): Promise<{ bytes: Uint8Array; cost: number | null; mediaType: string | null; usage: Record<string, unknown> }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const dataUrl = \`data:\${referenceMimeType};base64,\${bytesToBase64(referenceBytes)}\`;
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: \`Bearer \${apiKey}\`,
        "content-type": "application/json",
        "HTTP-Referer": "https://valorwell.org",
        "X-Title": "ValorWell BTY Thumbnail Generator",
      },
      body: JSON.stringify({
        model: MODEL,
        prompt,
        aspect_ratio: "16:9",
        quality: "high",
        background: "opaque",
        n: 1,
        input_references: [
          {
            type: "image_url",
            image_url: { url: dataUrl },
          },
        ],
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = String(body?.error?.message ?? body?.message ?? \`OpenRouter error \${response.status}\`);
      throw new ThumbnailError(
        "openrouter_failed",
        message,
        response.status === 408 || response.status === 429 || response.status >= 500,
        { status: response.status },
      );
    }

    const image = Array.isArray(body?.data) ? body.data[0] : null;
    const encoded = String(image?.b64_json ?? "");
    if (!encoded) {
      throw new ThumbnailError("openrouter_empty_image", "OpenRouter returned no image bytes.", true);
    }
    return {
      bytes: base64ToBytes(encoded),
      cost: Number.isFinite(Number(body?.usage?.cost)) ? Number(body.usage.cost) : null,
      mediaType: image?.media_type ? String(image.media_type) : null,
      usage: (body?.usage && typeof body.usage === "object") ? body.usage as Record<string, unknown> : {},
    };
  } catch (error) {
    if (error instanceof ThumbnailError) throw error;
    const message = safeMessage(error);
    throw new ThumbnailError(
      "openrouter_request_error",
      message,
      /abort|timeout|network|fetch/i.test(message),
    );
  } finally {
    clearTimeout(timer);
  }
}

type TextBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  horizontal: "left" | "right" | "center";
  vertical: "top" | "center" | "bottom";
};

const TEXT_BOXES: Record<Placement, TextBox> = {
  top_left: { x: 55, y: 42, width: 620, height: 285, horizontal: "left", vertical: "top" },
  top_right: { x: 605, y: 42, width: 620, height: 285, horizontal: "right", vertical: "top" },
  left: { x: 55, y: 155, width: 580, height: 410, horizontal: "left", vertical: "center" },
  right: { x: 645, y: 155, width: 580, height: 410, horizontal: "right", vertical: "center" },
  bottom_left: { x: 55, y: 390, width: 640, height: 275, horizontal: "left", vertical: "bottom" },
  bottom_right: { x: 585, y: 390, width: 640, height: 275, horizontal: "right", vertical: "bottom" },
  center: { x: 120, y: 180, width: 1040, height: 360, horizontal: "center", vertical: "center" },
};

function measureText(text: string, pointSize: number): number {
  const metrics = new Drawables()
    .font(FONT_NAME)
    .fontPointSize(pointSize)
    .fontTypeMetrics(text);
  return metrics?.textWidth ?? text.length * pointSize * 0.55;
}

function wrapHook(text: string, pointSize: number, maxWidth: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? \`\${current} \${word}\` : word;
    if (!current || measureText(candidate, pointSize) <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function chooseTextLayout(text: string, box: TextBox): { pointSize: number; lines: string[]; lineHeight: number } {
  for (let pointSize = 94; pointSize >= 44; pointSize -= 2) {
    const lines = wrapHook(text, pointSize, box.width);
    const lineHeight = pointSize * 1.04;
    if (lines.length <= 3 && lines.length * lineHeight <= box.height) {
      return { pointSize, lines, lineHeight };
    }
  }
  const pointSize = 42;
  return { pointSize, lines: wrapHook(text, pointSize, box.width), lineHeight: pointSize * 1.02 };
}

function drawHookText(image: Parameters<Drawables["draw"]>[0], hook: string, placement: Placement) {
  const box = TEXT_BOXES[placement] ?? TEXT_BOXES.top_right;
  const layout = chooseTextLayout(hook, box);
  const totalHeight = layout.lines.length * layout.lineHeight;

  let top = box.y;
  if (box.vertical === "center") top = box.y + (box.height - totalHeight) / 2;
  if (box.vertical === "bottom") top = box.y + box.height - totalHeight;

  layout.lines.forEach((line, index) => {
    const width = measureText(line, layout.pointSize);
    let x = box.x;
    if (box.horizontal === "right") x = box.x + box.width - width;
    if (box.horizontal === "center") x = box.x + (box.width - width) / 2;
    const baseline = top + layout.pointSize + index * layout.lineHeight;

    new Drawables()
      .font(FONT_NAME)
      .fontPointSize(layout.pointSize)
      .fillColor(new MagickColor("#000000"))
      .strokeColor(new MagickColor("#000000"))
      .strokeWidth(12)
      .text(Math.round(x + 6), Math.round(baseline + 7), line)
      .draw(image);

    const fill = layout.lines.length > 1 && index === layout.lines.length - 1
      ? new MagickColor("#FFD54A")
      : new MagickColor("#FFFFFF");

    new Drawables()
      .font(FONT_NAME)
      .fontPointSize(layout.pointSize)
      .fillColor(fill)
      .strokeColor(new MagickColor("#0A0A0A"))
      .strokeWidth(5)
      .text(Math.round(x), Math.round(baseline), line)
      .draw(image);
  });
}

async function renderFinalThumbnail(
  generatedBytes: Uint8Array,
  hook: string,
  placement: Placement,
): Promise<Uint8Array> {
  await ensureFont();
  return ImageMagick.read(generatedBytes, (image): Uint8Array => {
    image.resize(TARGET_WIDTH, TARGET_HEIGHT);
    drawHookText(image, hook, placement);
    image.quality = 88;
    return image.write(MagickFormat.Jpeg, (data) => new Uint8Array(data));
  });
}

async function uploadDriveFile(
  accessToken: string,
  folderId: string,
  fileName: string,
  bytes: Uint8Array,
): Promise<{ id: string; url: string }> {
  const boundary = \`valorwell-thumbnail-\${crypto.randomUUID()}\`;
  const metadata = {
    name: fileName,
    parents: [folderId],
    mimeType: "image/jpeg",
  };
  const body = new Blob([
    \`--\${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n\`,
    JSON.stringify(metadata),
    \`\r\n--\${boundary}\r\nContent-Type: image/jpeg\r\n\r\n\`,
    bytes,
    \`\r\n--\${boundary}--\r\n\`,
  ]);

  const response = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
    {
      method: "POST",
      headers: {
        authorization: \`Bearer \${accessToken}\`,
        "content-type": \`multipart/related; boundary=\${boundary}\`,
      },
      body,
      signal: AbortSignal.timeout(45_000),
    },
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result?.id) {
    throw new ThumbnailError(
      "drive_upload_failed",
      \`Drive thumbnail upload failed (\${response.status}): \${result?.error?.message ?? "unknown error"}\`,
      response.status === 429 || response.status >= 500,
    );
  }
  const id = String(result.id);
  return { id, url: \`https://drive.google.com/file/d/\${encodeURIComponent(id)}/view\` };
}

async function deleteDriveFile(accessToken: string, fileId: string) {
  const response = await fetch(
    \`https://www.googleapis.com/drive/v3/files/\${encodeURIComponent(fileId)}\`,
    {
      method: "DELETE",
      headers: { authorization: \`Bearer \${accessToken}\` },
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok && response.status !== 404) {
    log("orphan_cleanup_failed", { fileId, status: response.status });
  }
}

async function failJob(
  db: SupabaseClient,
  job: JobRow,
  workerId: string,
  error: ThumbnailError,
) {
  const { data, error: rpcError } = await db.rpc("fail_video_thumbnail_job", {
    p_job_id: job.id,
    p_worker_id: workerId,
    p_error: \`[\${error.code}] \${error.message}\`,
    p_retryable: error.retryable,
    p_result: { error_code: error.code, ...error.detail },
  });
  if (rpcError) {
    log("job_failure_record_failed", { jobId: job.id, error: rpcError.message });
    return null;
  }
  return data;
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!authorizeWorker(request)) return json({ error: "Unauthorized" }, 401);

  const openRouterKey = Deno.env.get("OPENROUTER_API_KEY") ?? "";
  if (!openRouterKey) {
    log("configuration_missing", { missing: "OPENROUTER_API_KEY" });
    return json({ ok: false, configuration: "OPENROUTER_API_KEY is not configured." }, 503);
  }

  const db = adminClient();
  const workerId = \`thumbnail-\${crypto.randomUUID()}\`;

  const { data: claimed, error: claimError } = await db.rpc("claim_next_video_thumbnail_job", {
    p_worker_id: workerId,
    p_lease_seconds: 300,
  });
  if (claimError) {
    log("claim_failed", { error: claimError.message });
    return json({ ok: false, error: claimError.message }, 500);
  }

  const job = (Array.isArray(claimed) ? claimed[0] : null) as JobRow | null;
  if (!job) return json({ ok: true, status: "idle" });

  log("job_claimed", { jobId: job.id, clipId: job.clip_id, attempts: job.attempts });

  try {
    const cachedFileId = String(job.payload?.thumbnail_uploaded_file_id ?? "");
    const cachedFileUrl = String(job.payload?.thumbnail_uploaded_file_url ?? "");
    if (cachedFileId && cachedFileUrl) {
      const { data: applied, error } = await db.rpc("complete_video_thumbnail_job", {
        p_job_id: job.id,
        p_worker_id: workerId,
        p_clip_id: job.clip_id,
        p_file_id: cachedFileId,
        p_file_url: cachedFileUrl,
        p_result: {
          reused_uploaded_file: true,
          model: String(job.payload?.thumbnail_model ?? MODEL),
          openrouter_cost_usd: job.payload?.thumbnail_openrouter_cost_usd ?? null,
        },
      });
      if (error) throw new ThumbnailError("completion_failed", error.message, true);
      if (!applied) {
        const token = await googleAccessToken(db);
        await deleteDriveFile(token, cachedFileId);
      }
      log("job_complete_reused_upload", { jobId: job.id, clipId: job.clip_id, applied: Boolean(applied) });
      return json({ ok: true, jobId: job.id, clipId: job.clip_id, applied: Boolean(applied), reusedUpload: true });
    }

    const { data: clipData, error: clipError } = await db
      .from("ai_operations_video_clips")
      .select("id,project_id,hook_text,primary_speaker,person_positioning,facial_expression,gesture_action,camera_framing,pose_family,core_visual,hook_text_placement,thumbnail_generation_revision,cover_image_file_id")
      .eq("id", job.clip_id)
      .maybeSingle();
    if (clipError) throw new ThumbnailError("clip_lookup_failed", clipError.message, true);
    if (!clipData) throw new ThumbnailError("clip_missing", "Thumbnail clip no longer exists.", false);
    const clip = clipData as ClipRow;

    const { data: projectData, error: projectError } = await db
      .from("ai_operations_video_projects")
      .select("id,tenant_id,guest_name,guest_image_url,source_file_name")
      .eq("id", clip.project_id)
      .maybeSingle();
    if (projectError) throw new ThumbnailError("project_lookup_failed", projectError.message, true);
    if (!projectData) throw new ThumbnailError("project_missing", "Thumbnail project no longer exists.", false);
    const project = projectData as ProjectRow;

    const { data: settingsData, error: settingsError } = await db
      .from("ai_operations_video_settings")
      .select("cover_image_folder_id,host_reference_name,host_reference_file_id,host_reference_url")
      .eq("tenant_id", project.tenant_id)
      .maybeSingle();
    if (settingsError) throw new ThumbnailError("settings_lookup_failed", settingsError.message, true);
    if (!settingsData?.cover_image_folder_id) {
      throw new ThumbnailError("cover_folder_missing", "YouTube Cover Images folder is not configured.", false);
    }
    const settings = settingsData as SettingsRow;

    if (clip.cover_image_file_id) {
      const { error: completeError } = await db.rpc("complete_video_thumbnail_job", {
        p_job_id: job.id,
        p_worker_id: workerId,
        p_clip_id: job.clip_id,
        p_file_id: null,
        p_file_url: null,
        p_result: { skipped: "cover_already_exists" },
      });
      if (completeError) throw new ThumbnailError("completion_failed", completeError.message, true);
      return json({ ok: true, jobId: job.id, clipId: job.clip_id, status: "skipped_existing_cover" });
    }

    const reference = await resolveReference(db, clip, project, settings);
    const prompt = buildPrompt(clip, project);
    const generated = await generateImage(
      openRouterKey,
      prompt,
      reference.bytes,
      reference.mimeType,
    );
    const finalBytes = await renderFinalThumbnail(
      generated.bytes,
      clip.hook_text,
      clip.hook_text_placement,
    );
    if (!finalBytes.length) throw new ThumbnailError("final_image_empty", "Final thumbnail bytes were empty.", true);
    if (finalBytes.byteLength > 2 * 1024 * 1024) {
      throw new ThumbnailError(
        "final_image_too_large",
        \`Final thumbnail is \${finalBytes.byteLength} bytes; expected at most 2 MB.\`,
        true,
      );
    }

    const { data: latestClip, error: latestClipError } = await db
      .from("ai_operations_video_clips")
      .select("cover_image_file_id")
      .eq("id", clip.id)
      .maybeSingle();
    if (latestClipError) throw new ThumbnailError("clip_recheck_failed", latestClipError.message, true);
    if (latestClip?.cover_image_file_id) {
      const { error: completeError } = await db.rpc("complete_video_thumbnail_job", {
        p_job_id: job.id,
        p_worker_id: workerId,
        p_clip_id: job.clip_id,
        p_file_id: null,
        p_file_url: null,
        p_result: {
          skipped: "cover_added_while_generating",
          model: MODEL,
          openrouter_cost_usd: generated.cost,
          usage: generated.usage,
        },
      });
      if (completeError) throw new ThumbnailError("completion_failed", completeError.message, true);
      return json({ ok: true, jobId: job.id, clipId: job.clip_id, status: "skipped_cover_added" });
    }

    const driveToken = await googleAccessToken(db);
    const metadataHash = String(job.payload?.metadata_hash ?? "metadata");
    const name = \`clip-\${clip.id}-thumb-r\${clip.thumbnail_generation_revision}-\${metadataHash.slice(0, 10)}-\${crypto.randomUUID()}.jpg\`;
    const uploaded = await uploadDriveFile(
      driveToken,
      String(settings.cover_image_folder_id),
      name,
      finalBytes,
    );

    const nextPayload = {
      ...(job.payload ?? {}),
      thumbnail_uploaded_file_id: uploaded.id,
      thumbnail_uploaded_file_url: uploaded.url,
      thumbnail_model: MODEL,
      thumbnail_openrouter_cost_usd: generated.cost,
      thumbnail_reference_source: reference.source,
      thumbnail_output_bytes: finalBytes.byteLength,
      thumbnail_width: TARGET_WIDTH,
      thumbnail_height: TARGET_HEIGHT,
      thumbnail_uploaded_at: new Date().toISOString(),
    };
    const { data: staged, error: stageError } = await db
      .from("ai_operations_video_jobs")
      .update({ payload: nextPayload, updated_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("status", "running")
      .eq("claimed_by", workerId)
      .select("id");
    if (stageError || !staged?.length) {
      throw new ThumbnailError(
        "upload_stage_persist_failed",
        stageError?.message ?? "Thumbnail upload could not be staged on the job.",
        true,
        { uploaded_file_id: uploaded.id, uploaded_file_url: uploaded.url },
      );
    }

    const { data: applied, error: completeError } = await db.rpc("complete_video_thumbnail_job", {
      p_job_id: job.id,
      p_worker_id: workerId,
      p_clip_id: job.clip_id,
      p_file_id: uploaded.id,
      p_file_url: uploaded.url,
      p_result: {
        model: MODEL,
        openrouter_cost_usd: generated.cost,
        usage: generated.usage,
        reference_source: reference.source,
        output_bytes: finalBytes.byteLength,
        width: TARGET_WIDTH,
        height: TARGET_HEIGHT,
        hook_text_placement: clip.hook_text_placement,
        metadata_hash: job.payload?.metadata_hash ?? null,
      },
    });
    if (completeError) throw new ThumbnailError("completion_failed", completeError.message, true);

    if (!applied) await deleteDriveFile(driveToken, uploaded.id);

    log("job_complete", {
      jobId: job.id,
      clipId: clip.id,
      applied: Boolean(applied),
      fileId: uploaded.id,
      cost: generated.cost,
    });
    return json({
      ok: true,
      jobId: job.id,
      clipId: clip.id,
      applied: Boolean(applied),
      fileId: uploaded.id,
      cost: generated.cost,
    });
  } catch (error) {
    const normalized = error instanceof ThumbnailError
      ? error
      : new ThumbnailError("unexpected_error", safeMessage(error), true);
    const nextStatus = await failJob(db, job, workerId, normalized);
    log("job_failed", {
      jobId: job.id,
      clipId: job.clip_id,
      code: normalized.code,
      retryable: normalized.retryable,
      nextStatus,
      error: normalized.message,
    });
    return json({
      ok: false,
      jobId: job.id,
      clipId: job.clip_id,
      error: normalized.code,
      message: normalized.message,
      nextStatus,
    }, normalized.retryable ? 503 : 422);
  }
});
