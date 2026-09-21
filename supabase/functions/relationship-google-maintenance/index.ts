import "jsr:@supabase/functions-js@2.4.5/edge-runtime.d.ts";
import { adminClient, json, TENANT_ID } from "../_shared/relationship-google.ts";
import {
  observationFlags,
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

    if (input.mode === "gmail_watch_only") {
      if (flags.gmail) results.gmailWatch = await renewGmailWatch(admin);
      console.log(JSON.stringify({ component: "relationship-google-maintenance", event: "complete", mode: input.mode, flags }));
      return json({ mode: input.mode, flags, results });
    }

    if (flags.gmail) {
      results.gmailSync = await syncGmail(admin);
      results.gmailWatch = await renewGmailWatch(admin);
    }
    if (flags.calendar) {
      results.calendarSync = await syncCalendar(admin);
      results.calendarWatch = await renewCalendarWatch(admin);
    }
    console.log(JSON.stringify({ component: "relationship-google-maintenance", event: "complete", mode: input.mode ?? "scheduled", flags }));
    return json({ mode: input.mode ?? "scheduled", flags, results });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

