import "jsr:@supabase/functions-js@2.4.5/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.93.1";

/**
 * Isolated daily operations watcher. Cron only; no HTTP client/user access.
 * Sends aggregate numerical metrics/timestamps to OpenRouter. Never sends PHI,
 * message content, names, patient/client IDs, email addresses or credentials.
 *
 * Required Edge secrets: CRON_SECRET, OPENROUTER_API_KEY, RESEND_API_KEY,
 * VALORWELL_MONITOR_ALERT_TO, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 * No scheduling should be enabled until an authenticated health check reports
 * ready=true and an approved, non-sensitive delivery check succeeds.
 */
const MODEL = "z-ai/glm-5.3-flash";
const TIME_ZONE = "America/Chicago";
const MAX_RESPONSE_CHARS = 2600;
type Json = Record<string, unknown>;
type Signal = {
  code: string; severity: "high" | "medium";
  metric: string; current: number; previous: number | null;
};
function response(body: Json, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
function secret(name: string): string { return (Deno.env.get(name) ?? "").trim(); }
function chicago(): { day: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const value = (name: string) => parts.find(p => p.type === name)?.value ?? "";
  return { day: value("year") + "-" + value("month") + "-" + value("day"), hour: Number(value("hour")) };
}
function num(object: Json, path: string): number {
  const [section, field] = path.split(".");
  const value = (object[section] as Json | undefined)?.[field];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function timestamp(object: Json, path: string): number | null {
  const [section, field] = path.split(".");
  const value = (object[section] as Json | undefined)?.[field];
  if (typeof value !== "string") return null;
  const date = new Date(value).getTime();
  return Number.isFinite(date) ? date : null;
}
function buildSignals(now: Json, previous: Json | null): Signal[] {
  const rules: Array<{code: string; metric: string; severity: "high" | "medium"; threshold: number; delta?: boolean}> = [
    { code: "unowned_replies", metric: "crm.unowned_replies", severity: "high", threshold: 0 },
    { code: "missing_reply_due", metric: "crm.replies_without_due", severity: "medium", threshold: 0, delta: true },
    { code: "unowned_tasks_growth", metric: "crm.unowned_open_tasks", severity: "medium", threshold: 0, delta: true },
    { code: "overdue_actions_growth", metric: "crm.overdue_next_actions", severity: "medium", threshold: 0, delta: true },
    { code: "missing_meeting_links", metric: "meetings.future_missing_calendar_event", severity: "high", threshold: 0 },
    { code: "booked_without_meeting_growth", metric: "meetings.booked_without_future_meeting", severity: "medium", threshold: 0, delta: true },
    { code: "stale_campaign_jobs", metric: "campaigns.stale_trigger_jobs", severity: "high", threshold: 0 },
    { code: "failed_campaign_jobs", metric: "campaigns.failed_trigger_jobs", severity: "high", threshold: 0 },
    { code: "new_dead_letters", metric: "integrations.new_dead_letters_24h", severity: "high", threshold: 0 },
    { code: "failed_emails", metric: "integrations.recent_failed_emails", severity: "medium", threshold: 0 },
    { code: "stripe_failed_events", metric: "stripe.failed_webhook_events_24h", severity: "high", threshold: 0 },
    { code: "stripe_unprocessed", metric: "stripe.unprocessed_webhook_events_over_hour", severity: "high", threshold: 0 },
    { code: "failed_integration_cron", metric: "cron.failed_monitor_jobs_24h", severity: "high", threshold: 0 },
  ];
  const signals: Signal[] = [];
  for (const rule of rules) {
    const current = num(now, rule.metric);
    const was = previous ? num(previous, rule.metric) : null;
    if (current <= rule.threshold) continue;
    // Existing historical backlogs only alert if worsening, except critical
    // current failures (they should be reported even on an initial baseline).
    if (rule.delta && (was === null || current <= was)) continue;
    if (!rule.delta && was !== null && current <= was) continue;
    signals.push({ code: rule.code, metric: rule.metric, current, previous: was, severity: rule.severity });
  }
  const lastSync = timestamp(now, "gmail.last_sync");
  const priorSync = previous ? timestamp(previous, "gmail.last_sync") : null;
  if ((lastSync === null || Date.now() - lastSync > 135 * 60_000) && (previous === null || priorSync !== lastSync)) {
    signals.push({code:"gmail_sync_stalled",metric:"gmail.last_sync",severity:"high",current: lastSync ? Math.round((Date.now()-lastSync)/60_000) : -1,previous:null});
  }
  const watch = timestamp(now, "gmail.watch_expires");
  const priorWatch = previous ? timestamp(previous, "gmail.watch_expires") : null;
  const priorObserved = previous && typeof previous.observed_at === "string" ? new Date(previous.observed_at).getTime() : null;
  const newlyExpiring = priorObserved !== null && watch !== null && watch - priorObserved >= 2 * 86400_000;
  if ((watch === null || watch - Date.now() < 2 * 86400_000) && (previous === null || priorWatch !== watch || newlyExpiring)) {
    signals.push({code:"gmail_watch_expiring",metric:"gmail.watch_expires",severity:"high",current:watch ? Math.round((watch-Date.now())/60_000): -1,previous:null});
  }
  return signals;
}
const SYS = [
  "You write brief operational incident summaries from precomputed counters only.",
  "Never invent root causes, contacts, financial transactions, messages, evidence or actions.",
  "Do not request secrets or reveal private information.",
  "Respond as JSON object with keys summary (one or two concise sentences) and recommendations (array of up to five brief phrases).",
  "If no new or actionable signals are present, summary must say no meaningful new issue was detected.",
  "Treat existing baseline counts as context, not proof of new incidents.",
].join(" ");

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return response({error:"method_not_allowed"}, 405);
  const expected = secret("CRON_SECRET");
  if (!expected || req.headers.get("x-cron-secret") !== expected) {
    return response({error:"unauthorized"}, 401);
  }
  const url = new URL(req.url);
  const configured = {
    cron: !!expected,
    service_role: !!secret("SUPABASE_SERVICE_ROLE_KEY") && !!secret("SUPABASE_URL"),
    openrouter: !!secret("OPENROUTER_API_KEY"),
    resend: !!secret("RESEND_API_KEY"),
    alert_destination: !!secret("VALORWELL_MONITOR_ALERT_TO"),
  };
  if (url.searchParams.get("mode") === "health") {
    return response({configured,ready:Object.values(configured).every(Boolean),model:MODEL,timezone:TIME_ZONE});
  }
  // 13:05/14:05 UTC cron executes twice daily, this local-hour gate selects
  // exactly one 8 AM America/Chicago run across DST changes.
  const clock = chicago();
  if (clock.hour !== 8) return response({status:"outside_daily_window",day:clock.day});
  if (!Object.values(configured).every(Boolean)) return response({error:"configuration_missing",configured}, 503);

  const db = createClient(secret("SUPABASE_URL"), secret("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: {persistSession:false,autoRefreshToken:false},
  });
  const {data:old,error:readError} = await db.from("valorwell_monitor_runs")
    .select("status").eq("run_day",clock.day).maybeSingle();
  if (readError) return response({error:"run_ledger_unavailable"}, 503);
  if (old && old.status !== "failed") return response({status:"already_processed",day:clock.day});
  const {data:baseline} = await db.from("valorwell_monitor_runs")
    .select("metrics").lt("run_day",clock.day).eq("status","completed")
    .order("run_day",{ascending:false}).limit(1).maybeSingle();
  const {data:metrics,error:snapshotError} = await db.rpc("valorwell_monitor_snapshot");
  if (snapshotError || !metrics || typeof metrics !== "object") {
    return response({error:"snapshot_unavailable"}, 503);
  }
  const signals = buildSignals(metrics as Json, (baseline?.metrics as Json | null) ?? null);
  const {error:insertError} = await db.from("valorwell_monitor_runs").upsert({
    run_day:clock.day, status:"running",model:MODEL,metrics,findings:signals,
  },{onConflict:"run_day"});
  if (insertError) return response({error:"run_claim_failed"},503);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(()=>controller.abort(), 100_000);
    let ai;
    try {
      ai = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method:"POST",signal:controller.signal,
        headers:{
          "Authorization":"Bearer " + secret("OPENROUTER_API_KEY"),
          "Content-Type":"application/json",
          "HTTP-Referer":"https://valorwell.org",
          "X-Title":"ValorWell Daily Operations Watch",
        },
        body:JSON.stringify({
          model:MODEL,temperature:0,max_tokens:950,
          response_format:{type:"json_object"},
          messages:[{role:"system",content:SYS},{role:"user",content:JSON.stringify({
            timestamp:new Date().toISOString(),model:MODEL,metrics,previous:baseline?.metrics??null,signals
          })}],
        }),
      });
    } finally {clearTimeout(timeout);}
    if (!ai.ok) throw new Error("openrouter_http_" + ai.status);
    const output = await ai.json();
    const content = output?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("openrouter_missing_text");
    let report: Json;
    try {report=JSON.parse(content);} catch {throw new Error("openrouter_invalid_json");}
    const summary = typeof report.summary==="string" ? report.summary.slice(0,MAX_RESPONSE_CHARS) : "Daily operational metrics reviewed.";
    const recs = Array.isArray(report.recommendations) ?
      report.recommendations.filter((x: unknown): x is string => typeof x==="string").slice(0,5).map(x=>x.slice(0,250)): [];
    let alertSent=false, alertError:null|string=null;
    if (signals.length) {
      const message = [
        "ValorWell daily exception watch (" + clock.day + ")",
        "Model: " + MODEL,
        "",
        summary,
        "",
        "Verified counters:",
        ...signals.map(s=>"- "+s.code+": "+s.current+(s.previous===null?"":" (previous "+s.previous+")")),
        "",
        "Suggested checks:",
        ...recs.map(s=>"- "+s),
        "",
        "Review live systems before changing statuses, resending email, claims or payments.",
      ].join("\n");
      const to = secret("VALORWELL_MONITOR_ALERT_TO");
      const from = secret("VALORWELL_MONITOR_ALERT_FROM") || "ValorWell Operations <alerts@updates.valorwell.org>";
      const mail = await fetch("https://api.resend.com/emails",{
        method:"POST",
        headers:{"Authorization":"Bearer "+secret("RESEND_API_KEY"),"Content-Type":"application/json"},
        body:JSON.stringify({from,to:[to],subject:"ValorWell daily exceptions — "+signals.length+" signals",text:message}),
      });
      if (mail.ok) alertSent=true;
      else alertError="resend_http_"+mail.status;
    }
    await db.from("valorwell_monitor_runs").update({
      status: alertError?"delivery_failed":"completed",
      summary,alert_sent:alertSent,alert_error:alertError,completed_at:new Date().toISOString()
    }).eq("run_day",clock.day);
    return response({status:alertError?"delivery_failed":"completed",day:clock.day,model:MODEL,signals:signals.length,alert_sent:alertSent});
  } catch(e) {
    const code=e instanceof Error ? e.message.slice(0,80):"unknown_error";
    await db.from("valorwell_monitor_runs").update({
      status:"failed",error_code:code,completed_at:new Date().toISOString()
    }).eq("run_day",clock.day);
    return response({error:code},502);
  }
});