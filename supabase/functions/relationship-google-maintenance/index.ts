import "jsr:@supabase/functions-js@2.4.5/edge-runtime.d.ts";
import { adminClient, json, TENANT_ID } from "../_shared/relationship-google.ts";
import {
  observationFlags,
  backfillGmailBatch,
  renewCalendarWatch,
  renewGmailWatch,
  syncCalendar,
  syncGmail,
} from "../_shared/relationship-google-sync.ts";

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const admin = adminClient();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authorization = request.headers.get("authorization") ?? "";
  const workerToken = request.headers.get("x-relationship-worker-token") ?? "";
  let authorized = Boolean(serviceKey) && authorization === `Bearer ${serviceKey}`;
  if (!authorized && workerToken) {
    const { data, error } = await admin.rpc("relationship_worker_token_valid", {
      p_tenant_id: TENANT_ID,
      p_token: workerToken,
    });
    authorized = !error && data === true;
  }
  if (!authorized) return json({ error: "Relationship worker authorization is required." }, 403);
  try {
    const input = await request.json().catch(() => ({})) as { mode?: string };
    const flags = await observationFlags(admin);
    const results: Record<string, unknown> = {};
    const failures: string[] = [];
    async function attempt(label: string, run: () => Promise<unknown>) {
      try {
        results[label] = await run();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(label);
        results[label] = { error: message };
        console.error(JSON.stringify({
          component: "relationship-google-maintenance",
          event: "operation_failed",
          operation: label,
          error: message,
        }));
      }
    }

    if (input.mode === "gmail_backfill") {
      if (flags.gmail) await attempt("gmailBackfill", () => backfillGmailBatch(admin));
      return json({ mode: input.mode, flags, results, failures }, failures.length ? 502 : 200);
    }

    // Renew first and independently. Renewal no longer changes the mailbox cursor.
    // A failed or long-running sync must not let the Pub/Sub watch silently expire.
    if (flags.gmail) await attempt("gmailWatch", () => renewGmailWatch(admin));
    if (input.mode !== "gmail_watch_only") {
      if (flags.gmail) await attempt("gmailSync", () => syncGmail(admin));
      if (flags.calendar) {
        await attempt("calendarSync", () => syncCalendar(admin));
        await attempt("calendarWatch", () => renewCalendarWatch(admin));
      }
    }
    const historicalBackfillPending = (
      results.gmailSync !== null && typeof results.gmailSync === "object" &&
      (results.gmailSync as Record<string, unknown>).historicalBackfillPending === true
    );
    console.log(JSON.stringify({
      component: "relationship-google-maintenance",
      event: failures.length ? "partial_failure" : historicalBackfillPending ? "degraded_backfill_pending" : "complete",
      mode: input.mode ?? "scheduled",
      flags,
      failures,
      historicalBackfillPending,
    }));
    // The caller sees a distinct degraded status until historical coverage is
    // restored; successful watch renewal does not imply backlog completion.
    return json(
      { mode: input.mode ?? "scheduled", flags, results, failures, historicalBackfillPending },
      failures.length ? 502 : historicalBackfillPending ? 207 : 200,
    );
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

