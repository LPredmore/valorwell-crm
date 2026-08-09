import "jsr:@supabase/functions-js@2.4.5/edge-runtime.d.ts";
import { adminClient, json } from "../_shared/relationship-google.ts";
import { observationFlags, syncCalendar } from "../_shared/relationship-google-sync.ts";

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const channelId = request.headers.get("x-goog-channel-id") ?? "";
  const resourceId = request.headers.get("x-goog-resource-id") ?? "";
  const channelToken = request.headers.get("x-goog-channel-token") ?? "";
  const resourceState = request.headers.get("x-goog-resource-state") ?? "";
  if (!channelId || !resourceId || !channelToken) return json({ error: "Calendar channel headers are required." }, 400);
  try {
    const admin = adminClient();
    const { data, error } = await admin.rpc("validate_relationship_calendar_channel", {
      p_channel_id: channelId,
      p_resource_id: resourceId,
      p_channel_token: channelToken,
    });
    if (error || !data || (data as Record<string, unknown>).valid !== true) {
      return json({ error: "Calendar notification channel is invalid." }, 401);
    }
    const flags = await observationFlags(admin);
    if (!flags.calendar || resourceState === "sync") {
      return json({ accepted: true, observed: false, reason: resourceState === "sync" ? "channel_sync" : "calendar_observation_disabled" });
    }
    const result = await syncCalendar(admin, String((data as Record<string, unknown>).connectionId));
    console.log(JSON.stringify({ component: "relationship-calendar-webhook", event: "sync_complete", resourceState }));
    return json({ accepted: true, result });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

