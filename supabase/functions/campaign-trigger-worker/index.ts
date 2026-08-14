import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.93.1";

type ClaimedJob = {
  jobId: string;
  claimToken: string;
  attemptCount: number;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  if (!serviceRoleKey || !supabaseUrl) return json({ error: "Worker runtime is not configured." }, 503);

  const authorization = request.headers.get("authorization") ?? "";
  const providedCronSecret = request.headers.get("x-cron-secret") ?? "";
  const authorized = authorization === `Bearer ${serviceRoleKey}` ||
    (cronSecret.length > 0 && providedCronSecret === cronSecret);
  if (!authorized) return json({ error: "Campaign trigger worker authorization is required." }, 403);

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const input = await request.json().catch(() => ({})) as { limit?: number; workerId?: string };
  const limit = Math.min(Math.max(Number(input.limit ?? 25), 1), 200);
  const workerId = String(input.workerId ?? `campaign-trigger-worker-${crypto.randomUUID()}`);

  const { data: claimed, error: claimError } = await admin.rpc("crm_claim_campaign_trigger_jobs", {
    p_worker_id: workerId,
    p_limit: limit,
    p_lease_seconds: 300,
  });
  if (claimError) return json({ error: claimError.message }, 500);

  const jobs = (claimed ?? []) as ClaimedJob[];
  const results: unknown[] = [];

  for (const job of jobs) {
    const { data, error } = await admin.rpc("crm_execute_campaign_trigger_job", {
      p_job_id: job.jobId,
      p_claim_token: job.claimToken,
    });
    if (error) {
      console.error("Trigger job execution failed", job.jobId, error.message);
      results.push({ jobId: job.jobId, outcome: "execution_error", error: error.message });
      continue;
    }
    results.push({ jobId: job.jobId, ...(data as Record<string, unknown>) });
  }

  return json({ workerId, claimed: jobs.length, results });
});
