import "jsr:@supabase/functions-js@2.4.5/edge-runtime.d.ts";
import { adminClient, authorizeWorker, json, logEvent, safeError } from "../_shared/ai-ops.ts";
import { youtubeAccessToken } from "../_shared/ai-ops-youtube.ts";
import * as youtube from "../_shared/youtube-publish/api.ts";
import { reconcileScheduledPublications } from "../_shared/youtube-publish/reconciliation.ts";
import { driveAccessToken, driveFileMetadata, driveFileRange } from "./drive.ts";
import { runPublishTicks } from "./worker.ts";

// Invoked every minute by pg_cron (video-youtube-publish-dispatcher-1min), gated by the
// X-Cron-Secret header. Overlapping invocations are safe: jobs are claimed atomically by
// claim_next_youtube_publish_job and each worker is identified by its own lease id.
Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!authorizeWorker(request)) return json({ error: "Unauthorized." }, 401);

  const db = adminClient();
  const workerId = `publish-${crypto.randomUUID()}`;
  const log = (event: string, detail: Record<string, unknown>) =>
    logEvent("video-youtube-publish-dispatcher", event, { workerId, ...detail });

  // Scheduled -> Published reconciliation first; a YouTube or database hiccup here must
  // never block publishing work.
  let reconciliation: Record<string, unknown> | null = null;
  try {
    reconciliation = await reconcileScheduledPublications({
      db, now: Date.now, youtubeToken: youtubeAccessToken, getDeliveryStatuses: youtube.getYoutubeDeliveryStatuses, log,
    });
  } catch (error) {
    log("reconciliation_failed", { error: safeError(error) });
    reconciliation = { error: safeError(error) };
  }

  try {
    const results = await runPublishTicks({
      db,
      workerId,
      now: Date.now,
      youtubeToken: youtubeAccessToken,
      driveToken: () => driveAccessToken(db),
      youtube,
      drive: { fileMetadata: driveFileMetadata, fileRange: driveFileRange },
      log,
    });
    return json({ ok: results.every((result) => result.ok), results, reconciliation });
  } catch (error) {
    log("dispatch_failed", { error: safeError(error) });
    return json({ ok: false, error: safeError(error), reconciliation }, 500);
  }
});
