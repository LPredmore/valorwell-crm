import "jsr:@supabase/functions-js@2.4.5/edge-runtime.d.ts";
import {
  adminClient,
  GMAIL_MAILBOX,
  GOOGLE_OAUTH_CALLBACK,
  googleJson,
  json,
  sha256Hex,
} from "../_shared/relationship-google.ts";

function redirectResult(connectionType: string, status: "connected" | "error", message?: string) {
  const appUrl = Deno.env.get("RELATIONSHIP_CRM_URL") ?? "https://crm.valorwell.org";
  const target = new URL("/crm/business-development/orchestration", appUrl);
  target.searchParams.set("google", status);
  target.searchParams.set("connection", connectionType || "unknown");
  if (message) target.searchParams.set("reason", message.slice(0, 180));
  return Response.redirect(target.toString(), 302);
}

async function verifyDriveWriteAccess(admin: ReturnType<typeof adminClient>, tenantId: string, accessToken: string) {
  const { data: settings, error: settingsError } = await admin
    .from("ai_operations_video_settings")
    .select("cover_image_folder_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (settingsError) throw new Error("Could not read the configured YouTube Cover Images folder: " + settingsError.message);

  const folderId = String(settings?.cover_image_folder_id ?? "").trim();
  if (!folderId) throw new Error("YouTube Cover Images folder is not configured.");

  const createResponse = await fetch(
    "https://www.googleapis.com/drive/v3/files?fields=id,name",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: `.valorwell-drive-write-probe-${Date.now()}.txt`,
        parents: [folderId],
        mimeType: "text/plain",
      }),
    },
  );
  const created = await createResponse.json().catch(() => ({})) as Record<string, unknown>;
  if (!createResponse.ok || typeof created.id !== "string") {
    const message = String((created as any)?.error?.message ?? "Unknown Google Drive API error");
    throw new Error(`Google Drive write verification failed (${createResponse.status}): ${message}`);
  }

  const probeId = created.id;
  const deleteResponse = await fetch(
    "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(probeId),
    {
      method: "DELETE",
      headers: { authorization: `Bearer ${accessToken}` },
    },
  );
  if (!deleteResponse.ok && deleteResponse.status !== 404) {
    console.warn(JSON.stringify({
      component: "relationship-google-oauth-callback",
      event: "drive_write_probe_cleanup_failed",
      file_id: probeId,
      status: deleteResponse.status,
    }));
  }
}

async function requeueDriveScopeThumbnailJobs(admin: ReturnType<typeof adminClient>) {
  const reset = {
    status: "queued",
    attempts: 0,
    error_code: null,
    error_class: null,
    error_message: null,
    claimed_by: null,
    claimed_at: null,
    lease_expires_at: null,
    completed_at: null,
    available_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { error: failedError } = await admin
    .from("ai_operations_video_jobs")
    .update(reset)
    .eq("job_type", "generate_thumbnail")
    .eq("status", "error")
    .in("error_code", ["drive_upload_failed", "drive_write_scope_missing"]);
  if (failedError) throw new Error("Could not requeue Drive-scope thumbnail failures: " + failedError.message);

  const { error: cancelledError } = await admin
    .from("ai_operations_video_jobs")
    .update(reset)
    .eq("job_type", "generate_thumbnail")
    .eq("status", "cancelled")
    .contains("result", { cancel_reason: "awaiting_drive_write_reauthorization" });
  if (cancelledError) throw new Error("Could not requeue thumbnails waiting for Drive reauthorization: " + cancelledError.message);
}

Deno.serve(async (request: Request) => {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  if (!state || !code || url.searchParams.has("error")) {
    return redirectResult("unknown", "error", url.searchParams.get("error") ?? "OAuth callback is incomplete.");
  }
  let connectionType = "unknown";
  try {
    const admin = adminClient();
    const { data: stateData, error: stateError } = await admin.rpc("consume_relationship_google_oauth_state", {
      p_state_hash: await sha256Hex(state),
    });
    if (stateError || !stateData) throw new Error(stateError?.message ?? "OAuth state is invalid.");
    const oauthState = stateData as Record<string, string>;
    connectionType = oauthState.connectionType;
    const clientId = Deno.env.get("GOOGLE_RELATIONSHIPS_CLIENT_ID") ?? "";
    const clientSecret = Deno.env.get("GOOGLE_RELATIONSHIPS_CLIENT_SECRET") ?? "";
    if (!clientId || !clientSecret) throw new Error("Google OAuth client is not configured.");
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        code_verifier: oauthState.codeVerifier,
        grant_type: "authorization_code",
        redirect_uri: GOOGLE_OAUTH_CALLBACK,
      }),
    });
    const token = await tokenResponse.json().catch(() => ({})) as Record<string, unknown>;
    if (!tokenResponse.ok || typeof token.access_token !== "string") {
      throw new Error(`Google OAuth token exchange failed (${tokenResponse.status}).`);
    }
    const accessToken = token.access_token;
    const userInfo = await googleJson("https://openidconnect.googleapis.com/v1/userinfo", accessToken);
    let accountEmail = String(userInfo.email ?? "").toLowerCase();
    let calendarId: string | null = null;
    if (connectionType === "gmail") {
      const profile = await googleJson("https://gmail.googleapis.com/gmail/v1/users/me/profile", accessToken);
      accountEmail = String(profile.emailAddress ?? "").toLowerCase();
      if (accountEmail !== GMAIL_MAILBOX) throw new Error("Gmail connection must authenticate exactly info@valorwell.org.");
    } else if (connectionType === "calendar") {
      const calendar = await googleJson("https://www.googleapis.com/calendar/v3/calendars/primary", accessToken);
      calendarId = String(calendar.id ?? "");
      if (!calendarId) throw new Error("Google primary Calendar could not be resolved.");
    } else if (connectionType === "drive") {
      accountEmail = String(userInfo.email ?? "").toLowerCase();
      if (accountEmail !== GMAIL_MAILBOX) throw new Error("Drive connection must authenticate exactly info@valorwell.org.");
      const driveResponse = await fetch(
        "https://www.googleapis.com/drive/v3/files?pageSize=1&fields=files(id,name)",
        { headers: { authorization: `Bearer ${accessToken}` } }
      );
      if (!driveResponse.ok) {
        const driveBody = await driveResponse.json().catch(() => ({})) as Record<string, any>;
        const gMessage = String(driveBody?.error?.message ?? "Unknown Google Drive API error");
        const gReason = String(driveBody?.error?.errors?.[0]?.reason ?? driveBody?.error?.status ?? "unknown");
        const gDetails = JSON.stringify(driveBody?.error?.details ?? []).slice(0, 800);
        throw new Error(`Google Drive API failed (${driveResponse.status}) [${gReason}]: ${gMessage}${gDetails && gDetails !== "[]" ? " | " + gDetails : ""}`);
      }
    } else {
      throw new Error("OAuth connection type is invalid.");
    }
    const scopeSet = String(token.scope ?? "").split(/\s+/).filter(Boolean);
    const required = connectionType === "gmail"
      ? "https://www.googleapis.com/auth/gmail.readonly"
      : connectionType === "drive"
      ? "https://www.googleapis.com/auth/drive"
      : "https://www.googleapis.com/auth/calendar.events.readonly";
    if (!scopeSet.includes(required)) {
      throw new Error(connectionType === "drive"
        ? "Google did not grant writable Drive access. Reconnect and approve the requested Drive permission."
        : "Google did not grant the required read-only scope.");
    }
    if (connectionType === "drive") {
      await verifyDriveWriteAccess(admin, oauthState.tenantId, accessToken);
    }
    const { error: storeError } = await admin.rpc("store_relationship_google_connection", {
      p_tenant_id: oauthState.tenantId,
      p_connection_type: connectionType,
      p_google_account_email: accountEmail,
      p_google_account_id: String(userInfo.sub ?? "") || null,
      p_calendar_id: calendarId,
      p_scopes: scopeSet,
      p_refresh_token: typeof token.refresh_token === "string" ? token.refresh_token : null,
      p_actor_profile_id: oauthState.actorProfileId,
    });
    if (storeError) throw new Error(storeError.message);
    if (connectionType === "drive") {
      await requeueDriveScopeThumbnailJobs(admin);
      await admin.from("ai_operations_video_oauth_events").insert({
        connection_type: "drive",
        status: "success",
        message: "Drive OAuth connection stored with writable scope; write probe succeeded and Drive-scope thumbnail jobs were requeued."
      });
    }
    return redirectResult(connectionType, "connected");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      const admin = adminClient();
      await admin.from("ai_operations_video_oauth_events").insert({
        connection_type: connectionType || "unknown",
        status: "error",
        message: message.slice(0, 4000)
      });
    } catch {}
    return redirectResult(connectionType, "error", message);
  }
});

