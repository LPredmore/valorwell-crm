import "jsr:@supabase/functions-js@2.4.5/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.93.1";

type Json = Record<string, unknown>;
const MODEL = "z-ai/glm-5.3-flash";
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store" }
});
const numberAt = (o: unknown, key: string) => {
  if (!o || typeof o !== "object" || Array.isArray(o)) return 0;
  const n = Number((o as Json)[key] ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const section = (o: Json, key: string): Json => (o[key] && typeof o[key] === "object" && !Array.isArray(o[key])) ? o[key] as Json : {};
function signals(stats: Json) {
  const gmail = section(stats,"gmail");
  const crm = section(stats,"crm_email");
  const db = section(stats,"database");
  const ring = section(stats,"ringcentral_crm");
  const found: Json[] = [];
  if (numberAt(gmail,"receipts_unlinked_after_5_minutes") > 0)
    found.push({code:"gmail_receipt_unlinked",severity:"review",count:numberAt(gmail,"receipts_unlinked_after_5_minutes"),note:"Source receipt does not have a direct CRM communication id match; investigate before creating an association"});
  if (numberAt(crm,"unlinked_inbound_last_24h") > 0)
    found.push({code:"crm_inbound_unlinked",severity:"review",count:numberAt(crm,"unlinked_inbound_last_24h"),note:"Unattributed CRM inbound email; do not guess identity"});
  if (numberAt(db,"failed_cron_last_hour") > 0)
    found.push({code:"cron_failures",severity:"high",count:numberAt(db,"failed_cron_last_hour")});
  if (numberAt(ring,"crm_inbound_sms_last_24h") === 0 && ring["latest_crm_sms_at"])
    found.push({code:"sms_provider_coverage_unverified",severity:"info",note:"CRM inbound SMS has no recent rows; a provider-side personal/shared inbox check is needed before calling this a sync failure"});
  return found;
}

/** Read-only extension-scoped RingCentral source coverage; no message content is retained or sent to AI. */
async function ringcentralCoverage(db: ReturnType<typeof createClient>, hours = 48): Promise<Json> {
  const id=Deno.env.get("RINGCENTRAL_CLIENT_ID")??"";
  const secret=Deno.env.get("RINGCENTRAL_CLIENT_SECRET")??"";
  const jwt=Deno.env.get("RINGCENTRAL_JWT_TOKEN")??"";
  const host=(Deno.env.get("RINGCENTRAL_SERVER_URL")||"https://platform.ringcentral.com").replace(/\/+$/,"");
  const baseline:Json={scope:"authenticated_extension_only",window_hours:hours,message_content_accessed_for_ai:false};
  if(!id||!secret||!jwt) return {...baseline,status:"not_configured"};
  if(!/^https:\/\/(platform\.ringcentral\.com|platform\.devtest\.ringcentral\.com)$/.test(host))
    return {...baseline,status:"unsupported_host"};
  try {
    const t=await fetch(host+"/restapi/oauth/token",{
      method:"POST",headers:{"content-type":"application/x-www-form-urlencoded","authorization":"Basic "+btoa(id+":"+secret)},
      body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion:jwt}),
      signal:AbortSignal.timeout(12000)
    });
    if(!t.ok) return {...baseline,status:"auth_failed",http_status:t.status};
    const access=String((await t.json())?.access_token||"");
    if(!access)return {...baseline,status:"auth_no_token"};
    let webhookStatus:Json={status:"unverified"};
    try {
      const sub=await fetch(host+"/restapi/v1.0/subscription",{
        headers:{"authorization":"Bearer "+access},signal:AbortSignal.timeout(12000)
      });
      if(!sub.ok)webhookStatus={status:"read_failed",http_status:sub.status};
      else {
        const raw=await sub.json(),rows=Array.isArray(raw.records)?raw.records:[];
        const relevant=rows.filter((r:Json)=>Array.isArray(r.eventFilters)&&
          r.eventFilters.some((e:unknown)=>typeof e==="string"&&e.includes("message-store")));
        webhookStatus={
          status:"ok",subscriptions_total:rows.length,message_store_subscriptions:relevant.length,
          webhook_active_sms_subscriptions:relevant.filter((r:Json)=>
            String((r.deliveryMode as Json)?.transportType??"").toLowerCase()==="webhook" &&
            String(r.status??"").toLowerCase()==="active").length,
          webhook_targeting_crm_function:relevant.some((r:Json)=>
            String((r.deliveryMode as Json)?.address??"").includes("/functions/v1/ringcentral-sms")),
          message_store_statuses:relevant.map((r:Json)=>String(r.status??"unknown")).slice(0,10)
        };
      }
    }catch{
      webhookStatus={status:"request_failed"};
    }
    const now=new Date(),from=new Date(now.getTime()-hours*3600000);
    const messageIds=new Set<string>();
    let complete=false,pages=0,observedInbound=0;
    const configuredNumber=(Deno.env.get("RINGCENTRAL_FROM_NUMBER")??"").replace(/\D/g,"").slice(-10);
    let matchingDestination=0,otherDestination=0,unknownDestination=0;
    for(let page=1;page<=5;page++){
      const params=new URLSearchParams({
        dateFrom:from.toISOString(),dateTo:now.toISOString(),messageType:"SMS",
        direction:"Inbound",availability:"Alive",perPage:"100",page:String(page)
      });
      const response=await fetch(host+"/restapi/v1.0/account/~/extension/~/message-store?"+params,{
        headers:{"authorization":"Bearer "+access},signal:AbortSignal.timeout(12000)
      });
      if(!response.ok) return {...baseline,status:response.status===403?"read_permission_denied":"provider_read_failed",http_status:response.status};
      const parsed=await response.json();
      const records=Array.isArray(parsed.records)?parsed.records:[];
      pages=page;
      for(const record of records){
        if(record?.type!=="SMS"||record?.direction!=="Inbound")continue;
        observedInbound++;
        const tos=Array.isArray(record.to)?record.to:[];
        const targets=tos.map((x:Json)=>String(x?.phoneNumber??"").replace(/\D/g,"").slice(-10)).filter(Boolean);
        if(!configuredNumber||targets.length===0)unknownDestination++;
        else if(targets.includes(configuredNumber))matchingDestination++;
        else otherDestination++;
        const msg=String(record.id??"");
        if(/^[0-9]{1,24}$/.test(msg))messageIds.add(msg);
      }
      const pageTotal=Number(parsed?.paging?.totalPages);
      if(records.length<100||(Number.isFinite(pageTotal)&&page>=pageTotal)){complete=true;break;}
    }
    const ids=[...messageIds];
    let matched=0;
    for(let i=0;i<ids.length;i+=80){
      const {data,error}=await db.from("crm_inbound_sms_logs")
        .select("ringcentral_message_id").in("ringcentral_message_id",ids.slice(i,i+80));
      if(error)return {...baseline,status:"crm_lookup_failed",provider_sms_count:ids.length};
      matched+=(data??[]).length;
    }
    return {...baseline,status:"ok",subscriptions:webhookStatus,complete,pages_examined:pages,provider_sms_count:ids.length,
      crm_matched_count:matched,crm_unmatched_count:ids.length-matched,
      configured_business_number_present:Boolean(configuredNumber),
      provider_messages_to_configured_business_number:matchingDestination,
      provider_messages_to_other_number:otherDestination,
      provider_messages_destination_unverified:unknownDestination,
      interpretation:"An unmatched personal-extension message may be outside the shared CRM business-number scope. Verify scope before treating it as missed import."};
  }catch(e){
    const code=e instanceof Error && e.name==="TimeoutError"?"timeout":"request_failed";
    return {...baseline,status:code};
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return reply({error:"method_not_allowed"},405);
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  const provided = req.headers.get("x-cron-secret") ?? "";
  if (!cronSecret || !provided || provided !== cronSecret) return reply({error:"unauthorized"},401);
  const url = Deno.env.get("SUPABASE_URL");
  const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !svc) return reply({error:"database_not_configured"},503);
  const admin = createClient(url,svc,{auth:{persistSession:false,autoRefreshToken:false}});
  const requestBody=await req.json().catch(()=>({})) as Json;
  if(requestBody.action==="source_probe")return reply({ok:true,ringcentral_provider:await ringcentralCoverage(admin,requestBody.window_hours===168?168:48)});
  if(requestBody.action==="health_probe"){
    const {data,error}=await admin.rpc("valorwell_hourly_operations_health_v1");
    return reply({ok:!error,health:error?null:data},error?503:200);
  }
  if(requestBody.action==="signals_probe"){
    const result=await admin.rpc("valorwell_hourly_comms_snapshot_v1");
    if(result.error||!result.data)return reply({error:"snapshot_unavailable"},503);
    const metrics=result.data as Json;
    metrics.ringcentral_provider=await ringcentralCoverage(admin);
    const findings=signals(metrics);
    const rc=section(metrics,"ringcentral_provider"),sub=section(rc,"subscriptions");
    if(sub.status==="ok" && Number(sub.webhook_active_sms_subscriptions||0)===0)
      findings.push({code:"ringcentral_sms_subscription_missing",severity:"critical"});
    if(rc.status==="ok" && Number(rc.crm_unmatched_count||0)>0)
      findings.push({code:"ringcentral_provider_ids_not_in_crm",severity:"review",count:Number(rc.crm_unmatched_count)});
    return reply({ok:true,signals:findings,source_status:rc.status,subscription_status:sub.status});
  }
  // Provider read-back repairs verified business-number SMS before CRM inbox triage.
  // A failed provider read is an exception, not permission to import guessed identities.
  async function repairBusinessSms():Promise<Json>{
    try{
      const r=await fetch(url+"/functions/v1/valorwell-ringcentral-business-sms-reconcile",{
        method:"POST",headers:{"content-type":"application/json","x-cron-secret":cronSecret},
        body:JSON.stringify({lookback_hours:48}),signal:AbortSignal.timeout(15000)
      });
      if(!r.ok)return {ok:false,error:"provider_reconcile_http_"+r.status};
      const x=await r.json();
      return {ok:true,examined:Number(x.examined||0),imported:Number(x.imported||0),existing:Number(x.existing||0),complete:x.complete===true};
    }catch{return {ok:false,error:"provider_reconcile_unavailable"};}
  }
  if(requestBody.action==="sync_probe"){
    const sms=await repairBusinessSms();
    const {data:triage,error}=await admin.rpc("valorwell_hourly_comms_triage_v1",{p_lookback_hours:24});
    return reply({ok:!error,sms,triage:error?null:triage},error?503:200);
  }
  const runHour = new Date(Math.floor(Date.now()/3600000)*3600000).toISOString();
  const {data:existing,error:oldError} = await admin.from("valorwell_hourly_comms_assistant_runs")
    .select("status").eq("run_hour",runHour).maybeSingle();
  if (oldError) return reply({error:"ledger_unavailable"},503);
  if (existing?.status === "ok") return reply({status:"already_ran",hour:runHour});
  // The CRM is the authoritative inbox and permissions system. Queue review tasks
  // deterministically; never send/alter messages based on AI inference.
  const smsRepair=await repairBusinessSms();
  const {data:triage,error:triageError}=await admin.rpc("valorwell_hourly_comms_triage_v1",{p_lookback_hours:24});
  if(triageError||!triage) return reply({error:"crm_inbox_triage_unavailable"},503);
  const {data:metrics,error:snapshotError} = await admin.rpc("valorwell_hourly_comms_snapshot_v1");
  if (snapshotError || !metrics || typeof metrics !== "object") {
    await admin.from("valorwell_hourly_comms_assistant_runs").upsert({
      run_hour:runHour,status:"snapshot_failed",model:MODEL,metrics:{},findings:[],error_code:"snapshot_unavailable",updated_at:new Date().toISOString()
    },{onConflict:"run_hour"});
    return reply({error:"snapshot_unavailable"},503);
  }
  const snap = metrics as Json;
  snap.crm_triage=triage as Json;
  const {data:operations,error:operationsError}=await admin.rpc("valorwell_hourly_operations_health_v1");
  snap.workflow_health=operationsError?{status:"unavailable"}:(operations as Json);
  snap.ringcentral_crm_reconcile=smsRepair;
  snap.ringcentral_provider=await ringcentralCoverage(admin);
  const findings = signals(snap);
  if(smsRepair.ok!==true)findings.push({code:"ringcentral_reconcile_unavailable",severity:"high"});
  const ops=section(snap,"workflow_health");
  if(operationsError) findings.push({code:"workflow_health_unavailable",severity:"high"});
  for(const [key,code] of [
    ["appointment_pending_over_10m","appointment_provisioning_delayed"],
    ["appointment_failed_recent_24h","appointment_recent_failed"],
    ["billing_outbox_stale_10m","clinical_billing_delayed"],
    ["therapist_match_outbox_overdue","therapist_match_notifications_delayed"],
    ["applicant_invites_overdue","applicant_invites_delayed"]
  ] as [string,string][]){
    const count=numberAt(ops,key);
    if(count>0)findings.push({code,severity:"high",count});
  }
  const rc=section(snap,"ringcentral_provider");
  const sub=section(rc,"subscriptions");
  if(sub.status==="ok" && Number(sub.webhook_active_sms_subscriptions||0)===0)
    findings.push({code:"ringcentral_sms_subscription_missing",severity:"critical",
      next_action:"RingCentral application subscription create returned HTTP 403. Repair provider notification permission; hourly read-only SMS reconciliation remains active."});
  if(rc.status==="ok" && Number(rc.crm_unmatched_count||0)>0)
    findings.push({code:"ringcentral_provider_ids_not_in_crm",severity:"review",count:Number(rc.crm_unmatched_count),
    note:"Authenticated extension scope may differ from CRM business-number scope; confirm before treating as failure."});
  if(rc.status!=="ok")
    findings.push({code:"ringcentral_source_coverage_unverified",severity:"info",status:rc.status});
  const {error:startError} = await admin.from("valorwell_hourly_comms_assistant_runs").upsert({
    run_hour:runHour,status:"running",model:MODEL,metrics:snap,findings,error_code:null,updated_at:new Date().toISOString()
  },{onConflict:"run_hour"});
  if (startError) return reply({error:"ledger_write_failed"},503);
  const key = Deno.env.get("OPENROUTER_API_KEY") ?? "";
  if (!key) {
    await admin.from("valorwell_hourly_comms_assistant_runs").update({
      status:"model_failed",error_code:"openrouter_key_missing",updated_at:new Date().toISOString()
    }).eq("run_hour",runHour);
    return reply({error:"model_not_configured"},503);
  }
  try {
    const aiResponse = await fetch("https://openrouter.ai/api/v1/chat/completions",{
      method:"POST",
      headers:{"authorization": "Bearer "+key, "content-type":"application/json","X-Title":"ValorWell Hourly Communications Reconciliation"},
      body:JSON.stringify({
        model:MODEL,
        temperature:0,
        max_tokens:650,
        response_format:{type:"json_object"},
        messages:[
          {role:"system",content:"You are a cautious operations analyst. The supplied information contains ONLY aggregate counts and timestamps. Produce JSON with fields summary (string), priorities (array of objects with code, severity, next_action), and automated_actions_taken (always an empty array). Only identify supported evidence; an old CRM SMS timestamp by itself does NOT prove lost RingCentral messages. Never fabricate emails, messages, clients, send attempts, or fixes. Do not recommend sending notifications without review. No PHI is provided."},
          {role:"user",content:JSON.stringify({metrics:snap,signals:findings})}
        ]
      }),
      signal:AbortSignal.timeout(18000)
    });
    if (!aiResponse.ok) throw new Error("openrouter_status_"+aiResponse.status);
    const payload = await aiResponse.json();
    const raw = payload?.choices?.[0]?.message?.content;
    if (typeof raw !== "string" || raw.length > 16000) throw new Error("invalid_model_response");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid_model_json");
    const {error:saveError} = await admin.from("valorwell_hourly_comms_assistant_runs").update({
      status:"ok",findings:[...findings,{code:"model_assessment",data:parsed}],
      error_code:null,completed_at:new Date().toISOString(),updated_at:new Date().toISOString()
    }).eq("run_hour",runHour);
    if (saveError) return reply({error:"model_result_not_saved"},503);
    return reply({ok:true,status:"ok",hour:runHour,model:MODEL,signals:findings.length,
      crm_review_tasks_created:Number((triage as Json).new_email_review_tasks||0)+Number((triage as Json).new_sms_review_tasks||0),
      automated_messages_sent:0});
  } catch (e) {
    const code = e instanceof Error ? e.message.replace(/[^a-z0-9_]/gi,"_").slice(0,80) : "model_failed";
    await admin.from("valorwell_hourly_comms_assistant_runs").update({
      status:"model_failed",error_code:code,completed_at:new Date().toISOString(),updated_at:new Date().toISOString()
    }).eq("run_hour",runHour);
    return reply({ok:false,status:"model_failed",hour:runHour,error:code},502);
  }
});