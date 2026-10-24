import "jsr:@supabase/functions-js@2.4.5/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.93.1";

const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
const onlyDigits=(s:unknown)=>String(s??"").replace(/[^0-9]/g,"");
const last10=(s:unknown)=>onlyDigits(s).slice(-10);
const TENANT="00000000-0000-0000-0000-000000000001";
Deno.serve(async(req:Request)=>{
 if(req.method!=="POST")return reply({error:"method_not_allowed"},405);
 const cronSecret=Deno.env.get("CRON_SECRET")??"";
 if(!cronSecret||req.headers.get("x-cron-secret")!==cronSecret)return reply({error:"unauthorized"},401);
 const id=Deno.env.get("RINGCENTRAL_CLIENT_ID")??"";
 const secret=Deno.env.get("RINGCENTRAL_CLIENT_SECRET")??"";
 const jwt=Deno.env.get("RINGCENTRAL_JWT_TOKEN")??"";
 const configured=last10(Deno.env.get("RINGCENTRAL_FROM_NUMBER")??"");
 const url=Deno.env.get("SUPABASE_URL")??"";
 const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
 const host=(Deno.env.get("RINGCENTRAL_SERVER_URL")??"https://platform.ringcentral.com").replace(/\/+$/,"");
 if(!id||!secret||!jwt||!configured||configured.length!==10||!url||!serviceKey)return reply({error:"provider_or_crm_not_configured"},503);
 if(!/^https:\/\/(platform\.ringcentral\.com|platform\.devtest\.ringcentral\.com)$/.test(host))return reply({error:"unsupported_provider_host"},503);
 const body=await req.json().catch(()=>({})) as {lookback_hours?:number};
 const requested=Number(body.lookback_hours??48);
 const hours=Math.min(Math.max(Number.isFinite(requested)?requested:48,1),168);
 const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
 try{
  const authResponse=await fetch(host+"/restapi/oauth/token",{
   method:"POST",headers:{"content-type":"application/x-www-form-urlencoded","authorization":"Basic "+btoa(id+":"+secret)},
   body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion:jwt}),
   signal:AbortSignal.timeout(12000)});
  if(!authResponse.ok)return reply({error:"provider_auth_failed",http_status:authResponse.status},503);
  const token=String((await authResponse.json())?.access_token??"");
  if(!token)return reply({error:"provider_access_token_missing"},503);
  const end=new Date(),start=new Date(end.getTime()-hours*3600000);
  let examined=0,eligible=0,imported=0,existing=0,excludedScope=0,skippedInvalid=0,complete=false,pages=0;
  for(let page=1;page<=5;page++){
    const params=new URLSearchParams({dateFrom:start.toISOString(),dateTo:end.toISOString(),messageType:"SMS",direction:"Inbound",availability:"Alive",perPage:"100",page:String(page)});
    const response=await fetch(host+"/restapi/v1.0/account/~/extension/~/message-store?"+params,{
      headers:{"authorization":"Bearer "+token},signal:AbortSignal.timeout(12000)});
    if(!response.ok)return reply({error:"provider_read_failed",http_status:response.status,pages,imported},503);
    const data=await response.json(),rows=Array.isArray(data.records)?data.records:[];
    pages=page;
    for(const rec of rows){
      if(rec?.type!=="SMS"||rec?.direction!=="Inbound")continue;
      examined++;
      const targets=Array.isArray(rec.to)?rec.to:[];
      if(!targets.some((target:{phoneNumber?:string})=>last10(target?.phoneNumber)===configured)){excludedScope++;continue;}
      const messageId=String(rec?.id??"");
      const from=last10(rec?.from?.phoneNumber);
      const eventTime=Date.parse(String(rec?.creationTime??""));
      if(!/^[0-9]{1,24}$/.test(messageId)||from.length!==10||!Number.isFinite(eventTime)){skippedInvalid++;continue;}
      eligible++;
      const {data:found,error:foundError}=await admin.from("crm_inbound_sms_logs").select("id").eq("ringcentral_message_id",messageId).maybeSingle();
      if(foundError)return reply({error:"crm_duplicate_check_failed",pages,imported},503);
      if(found){existing++;continue;}
      // Store a business number's message in the existing HIPAA-controlled CRM database,
      // not the OpenRouter AI payload. Never guess a client or applicant identity.
      const {error:insertError}=await admin.from("crm_inbound_sms_logs").insert({
        tenant_id:TENANT,client_id:null,provider_applicant_id:null,
        ringcentral_message_id:messageId,from_phone:"+1"+from,
        to_phone:"+1"+configured,message_body:typeof rec.subject==="string"?rec.subject:null,
        received_at:new Date(eventTime).toISOString(),is_read:false
      });
      if(insertError?.code==="23505"){existing++;continue;}
      if(insertError)return reply({error:"crm_insert_failed",code:insertError.code??"unknown",pages,imported},503);
      imported++;
    }
    const pageCount=Number(data?.paging?.totalPages);
    if(rows.length<100||(Number.isFinite(pageCount)&&page>=pageCount)){complete=true;break;}
  }
  if(!complete)return reply({error:"provider_page_limit_exceeded",hours,pages,imported,success:false},503);
  return reply({ok:true,hours,pages,examined,eligible,existing,imported,excluded_scope:excludedScope,invalid_skipped:skippedInvalid,complete,
    note:"Only exact configured business-number messages imported; no guessed CRM contact link and no external AI content sharing."});
 }catch(e){
  return reply({error:e instanceof Error&&e.name==="TimeoutError"?"provider_timeout":"reconciliation_failed"},503);
 }
});