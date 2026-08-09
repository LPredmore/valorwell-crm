import "jsr:@supabase/functions-js@2.4.5/edge-runtime.d.ts";
import {
  adminClient,
  base64UrlToBytes,
  GMAIL_MAILBOX,
  GMAIL_PUSH_AUDIENCE,
  json,
  PUBSUB_PUSH_IDENTITY,
  verifyGoogleOidc,
} from "../_shared/relationship-google.ts";
import { observationFlags, syncGmail } from "../_shared/relationship-google-sync.ts";

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    await verifyGoogleOidc(
      request.headers.get("authorization") ?? "",
      GMAIL_PUSH_AUDIENCE,
      PUBSUB_PUSH_IDENTITY,
    );
    const envelope = await request.json() as {
      message?: { data?: string; messageId?: string; publishTime?: string };
      subscription?: string;
    };
    if (!envelope.message?.data) return json({ error: "Pub/Sub message data is required." }, 400);
    const notification = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(envelope.message.data)),
    ) as { emailAddress?: string; historyId?: string };
    if (notification.emailAddress?.toLowerCase() !== GMAIL_MAILBOX || !notification.historyId) {
      return json({ error: "Pub/Sub Gmail notification is invalid." }, 400);
    }
    const admin = adminClient();
    const flags = await observationFlags(admin);
    if (!flags.gmail) return json({ accepted: true, observed: false, reason: "gmail_observation_disabled" });
    const result = await syncGmail(admin, notification.historyId);
    console.log(JSON.stringify({ component: "relationship-gmail-push", event: "sync_complete", historyId: notification.historyId }));
    return json({ accepted: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const authFailure = /OIDC|token|claims|signing/i.test(message);
    return json({ error: message }, authFailure ? 401 : 500);
  }
});

