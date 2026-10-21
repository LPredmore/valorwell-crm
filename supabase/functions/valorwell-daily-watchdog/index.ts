import "jsr:@supabase/functions-js@2.4.5/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.93.1";
const reply = (x: unknown, status=200) => new Response(JSON.stringify(x),
  {status, headers:{"content-type":"application/json"}});
Deno.serve(async request => {
  if(request.method!=="POST") return reply({error:"method_not_allowed"},405);
  const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const url=Deno.env.get("SUPABASE_URL");
  const resend=Deno.env.get("RESEND_API_KEY");
  const token=request.headers.get("x-cron-secret")??"";
  if(!key||!url||!resend) return reply({error:"configuration_missing"},503);
  if(token.length<24||token.length>512) return reply({error:"forbidden"},403);
  const db=createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
  const auth=await db.rpc("valorwell_daily_watch_cron_token_valid_v1",{p_token:token});
  if(auth.error||auth.data!==true) return reply({error:"forbidden"},403);
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",
    year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const field=(t:string)=>parts.find(p=>p.type===t)?.value??"";
  const day=`${field("year")}-${field("month")}-${field("day")}`;
  const run=await db.from("valorwell_daily_watch_runs").select("status")
    .eq("run_day",day).maybeSingle();
  if(run.error) return reply({error:"run_history_failed"},503);
  if(run.data?.status==="ok") return reply({state:"healthy",day});
  const past=await db.from("valorwell_watchdog_alerts").select("status")
    .eq("run_day",day).maybeSingle();
  if(past.error) return reply({error:"dedupe_unavailable"},503);
  if(past.data?.status==="delivered") return reply({state:"already_notified",day});
  const reason=run.data?.status??"missing";
  let delivered=false;
  try {
    const response=await fetch("https://api.resend.com/emails",{
      method:"POST",signal:AbortSignal.timeout(15000),
      headers:{authorization:`Bearer ${resend}`,"content-type":"application/json"},
      body:JSON.stringify({from:"ValorWell Operations <updates@updates.valorwell.org>",
        to:["info@valorwell.org"],
        subject:`ACTION REQUIRED — ValorWell monitor failure (${day})`,
        text:`The daily external OpenRouter monitor did not finish successfully by 10 AM Central. Reason: ${reason}. Check Supabase daily watch run history and cron job 107. No private data is included.`})
    });
    delivered=response.ok;
  }catch { delivered=false; }
  const saved=await db.from("valorwell_watchdog_alerts").upsert({
    run_day:day,status:delivered?"delivered":"delivery_failed",reason_code:reason,
    notified_at:delivered?new Date().toISOString():null,
    updated_at:new Date().toISOString()},{onConflict:"run_day"});
  if(saved.error) return reply({error:"watchdog_audit_failed"},503);
  return reply({state:delivered?"alert_sent":"delivery_failed",day,reason},delivered?200:502);
});
