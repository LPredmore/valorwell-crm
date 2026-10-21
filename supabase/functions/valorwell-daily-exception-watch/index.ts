import "jsr:@supabase/functions-js@2.4.5/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.93.1";

// Server-only. External LLM receives AGGREGATES, never record details or private content.
const MODEL = "z-ai/glm-5.3-flash";
const TZ = "America/Chicago";
const FROM = "ValorWell Operations <updates@updates.valorwell.org>";
const TO = "info@valorwell.org";
const PROJECT = "valorwell";
type Metric = Record<string, unknown>;
type Incident = { code: string; severity: "critical" | "warning"; current: number; previous: number | null };
const numberAt = (obj: Metric, group: string, field: string): number | null => {
  const value = (obj[group] as Record<string, unknown> | undefined)?.[field];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const chicagoDay = (now = new Date()) => {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (name: string) => p.find(x => x.type === name)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
};
function incidents(current: Metric, previous: Metric | null): Incident[] {
  const out: Incident[] = [];
  const item = (code: string, group: string, field: string, critical: number, compareGrowth = false) => {
    const n = numberAt(current, group, field);
    const before = previous ? numberAt(previous, group, field) : null;
    if (n === null || n <= 0) return;
    if (compareGrowth ? (before !== null ? n > before : n >= critical) : n >= critical) {
      out.push({ code, severity: compareGrowth ? "warning" : "critical", current: n, previous: before });
    }
  };
  item("gmail_sync_stale", "gmail", "sync_age_minutes", 240);
  const watch = numberAt(current, "gmail", "watch_expires_in_hours");
  if (watch !== null && watch < 24) out.push({ code: "gmail_watch_expiring", severity: "critical", current: watch, previous: previous ? numberAt(previous, "gmail", "watch_expires_in_hours") : null });
  item("unassigned_new_replies", "new_replies", "unassigned", 1, true);
  item("new_replies_without_followup", "new_replies", "without_followup_due", 10, true);
  item("unassigned_crm_tasks", "crm_tasks", "unassigned_open", 9, true);
  item("overdue_opportunities_growth", "opportunities", "actionable_overdue", 12, true);
  item("meeting_links_missing", "meetings", "future_unlinked", 1, true);
  item("campaign_trigger_failures", "campaign_trigger_jobs", "failed", 1, true);
  item("stuck_campaign_triggers", "campaign_trigger_jobs", "overdue_unprocessed", 1, true);
  item("integration_dead_letters", "outbox", "dead_lettered_24h", 1);
  item("integration_stuck_ready", "outbox", "stuck_ready", 1, true);
  item("stripe_webhook_failures", "stripe", "failed_24h", 1);
  item("stripe_webhook_unprocessed", "stripe", "unprocessed_older_than_hour", 1);
  item("gmail_maintenance_cron_failures", "cron", "failed_runs_24h", 1);
  return out;
}
const htmlSafe = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const provided = request.headers.get("x-cron-secret") || "";
  if (provided.length < 24 || provided.length > 512) return json({ error: "forbidden" }, 403);
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  if (!serviceKey || !supabaseUrl) return json({ error: "server_configuration_missing" }, 503);
  const db = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: tokenValid, error: tokenError } = await db.rpc("valorwell_daily_watch_cron_token_valid_v1", { p_token: provided });
  if (tokenError || tokenValid !== true) return json({ error: "forbidden" }, 403);
  const input = await request.json().catch(() => ({})) as { mode?: string };
  const apiKey = Deno.env.get("OPENROUTER_API_KEY") || "";
  const resendKey = Deno.env.get("RESEND_API_KEY") || "";
  if (input.mode === "preflight") return json({
    component: "valorwell-daily-exception-watch", model: MODEL,
    openrouter_key_configured: Boolean(apiKey), resend_key_configured: Boolean(resendKey),
    service_role_configured: Boolean(serviceKey && supabaseUrl), schedule_expected: "08:00 America/Chicago",
    ready: Boolean(apiKey && resendKey && serviceKey && supabaseUrl),
  });
  if (!apiKey || !resendKey || !serviceKey || !supabaseUrl) return json({ error: "credentials_not_configured", missing: [
    !apiKey && "OPENROUTER_API_KEY", !resendKey && "RESEND_API_KEY", (!serviceKey || !supabaseUrl) && "SUPABASE_SERVER_ENV",
  ].filter(Boolean) }, 503);
  const day = chicagoDay();
  const { data: existing, error: existingErr } = await db.from("valorwell_daily_watch_runs").select("status,notified").eq("run_day", day).maybeSingle();
  if (existingErr) return json({ error: "history_query_failed" }, 500);
  if (existing?.status === "ok") return json({ status: "already_ran", day });
  const { data: snapshot, error: snapErr } = await db.rpc("valorwell_daily_watch_snapshot_v1");
  if (snapErr || !snapshot || typeof snapshot !== "object") return json({ error: "snapshot_unavailable" }, 503);
  const { data: history, error: histErr } = await db.from("valorwell_daily_watch_runs")
    .select("metrics").lt("run_day", day).eq("status", "ok").order("run_day", { ascending: false }).limit(1);
  if (histErr) return json({ error: "baseline_unavailable" }, 503);
  const prev = history?.[0]?.metrics as Metric | undefined;
  const data = snapshot as Metric;
  const signals = incidents(data, prev || null);
  const prompt = {
    purpose: "Anomaly-only daily operating review. No PHI or message content.",
    rules: "Report only signals listed under candidate_incidents, do not invent events or people. If no candidates, produce a one-sentence no-new-issues summary. Keep summaries under 350 characters.",
    model: MODEL, date_central: day, current_aggregate_metrics: data,
    previous_aggregate_metrics: prev || null, candidate_incidents: signals,
  };
  let result: { summary?: string; findings?: { code: string; explanation?: string }[] } = {};
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST", signal: AbortSignal.timeout(35000),
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "HTTP-Referer": "https://valorwell.org", "X-Title": "ValorWell Daily Exception Watch" },
      body: JSON.stringify({
        model: MODEL, temperature: 0, max_tokens: 900,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: 'Analyze only the supplied numeric operational metrics. Reply JSON: {"summary":"...","findings":[{"code":"one input candidate code","explanation":"one concise sentence"}]}. Never invent metrics, policies, remediation success, personal details or clinical claims.' },
          { role: "user", content: JSON.stringify(prompt) },
        ],
      }),
    });
    if (!response.ok) throw new Error("model_http_failure");
    const body = await response.json();
    const raw = body?.choices?.[0]?.message?.content;
    if (typeof raw !== "string") throw new Error("model_missing_content");
    result = JSON.parse(raw);
    if (typeof result !== "object" || !result || !Array.isArray(result.findings)) throw new Error("model_invalid_schema");
  } catch {
    await db.from("valorwell_daily_watch_runs").upsert({
      run_day: day, model: MODEL, status: "model_failed", metrics: data, findings: signals,
      notified: false, error_code: "openrouter_request_failed", updated_at: new Date().toISOString(),
    }, { onConflict: "run_day" });
    return json({ error: "model_request_failed", day }, 502);
  }
  const descriptions = new Map((result.findings || []).filter(x => typeof x?.code === "string" && typeof x?.explanation === "string")
    .map(x => [x.code, x.explanation!.slice(0, 240)]));
  const findings = signals.map(s => ({
    ...s, explanation: descriptions.get(s.code) || `Operational signal ${s.code}: current=${s.current}, prior=${s.previous ?? "baseline"}`,
  }));
  const summary = typeof result.summary === "string" ? result.summary.slice(0, 350) : "Daily operational review complete.";
  let notified = false;
  let errorCode: string | null = null;
  if (findings.length > 0) {
    const lines = findings.map(f => `${f.severity.toUpperCase()} ${f.code}: ${f.explanation} (current ${f.current}, previous ${f.previous ?? "baseline"})`);
    const text = `ValorWell monitored exceptions — ${day} (Central)\nModel: ${MODEL}\n\n${summary}\n\n${lines.join("\n")}\n\nVerify authoritative records before changing systems. Automated review is read-only.`;
    try {
      const send = await fetch("https://api.resend.com/emails", {
        method: "POST", signal: AbortSignal.timeout(15000),
        headers: { authorization: `Bearer ${resendKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from: FROM, to: [TO], subject: `ValorWell live exceptions — ${day} (${findings.length})`,
          text, html: `<pre style="white-space:pre-wrap;font-family:Arial,sans-serif">${htmlSafe(text)}</pre>` }),
      });
      notified = send.ok;
      if (!send.ok) errorCode = "resend_delivery_rejected";
    } catch { errorCode = "resend_delivery_failed"; }
  }
  const status = errorCode ? "notify_failed" : "ok";
  const { error: saveErr } = await db.from("valorwell_daily_watch_runs").upsert({
    run_day: day, model: MODEL, status, metrics: data,
    findings, notified, error_code: errorCode, updated_at: new Date().toISOString(),
  }, { onConflict: "run_day" });
  if (saveErr) return json({ error: "run_persistence_failed" }, 503);
  return json({ day, status, model: MODEL, candidate_count: findings.length, notified, has_errors: Boolean(errorCode) }, errorCode ? 502 : 200);
});
