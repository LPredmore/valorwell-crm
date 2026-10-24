import { createClient } from "npm:@supabase/supabase-js@2.93.1";
import "jsr:@supabase/functions-js@2.4.5/edge-runtime.d.ts";
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{"content-type":"application/json","cache-control":"no-store"}
});
const FILTER="/restapi/v1.0/account/~/extension/~/message-store/instant?type=SMS";
const CALLBACK="https://ahqauomkgflopxgnlndd.supabase.co/functions/v1/ringcentral-sms?action=inbound";
function relevant(r:Record<string,unknown>){
  const delivery=(r.deliveryMode??{}) as Record<string,unknown>;
  return String(delivery.address??"")===CALLBACK&&
    Array.isArray(r.eventFilters)&&r.eventFilters.some((f)=>typeof f==="string"&&f.includes("message-store")&&f.includes("SMS"))&&
    String(delivery.transportType??"").toLowerCase()==="webhook";
}
Deno.serve(async(req:Request)=>{
 if(req.method!=="POST")return json({error:"method_not_allowed"},405);
 const expected=Deno.env.get("CRON_SECRET")??"";
 const supplied=req.headers.get("x-cron-secret")??"";
 if(!expected||!supplied||expected!==supplied)return json({error:"unauthorized"},401);
 const client=Deno.env.get("RINGCENTRAL_CLIENT_ID")??"";
 const secret=Deno.env.get("RINGCENTRAL_CLIENT_SECRET")??"";
 const jwt=Deno.env.get("RINGCENTRAL_JWT_TOKEN")??"";
 const url=Deno.env.get("SUPABASE_URL")??"";
 const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
 const host=(Deno.env.get("RINGCENTRAL_SERVER_URL")||"https://platform.ringcentral.com").replace(/\/+$/,"");
 if(!client||!secret||!jwt||!url||!serviceKey)return json({status:"missing_ringcentral_configuration"},503);
 if(!/^https:\/\/(platform\.ringcentral\.com|platform\.devtest\.ringcentral\.com)$/.test(host))
   return json({status:"unsupported_host"},503);
 try {
   const tokenResult=await fetch(host+"/restapi/oauth/token",{
    method:"POST",headers:{"content-type":"application/x-www-form-urlencoded","authorization":"Basic "+btoa(client+":"+secret)},
    body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion:jwt}),
    signal:AbortSignal.timeout(12000)
   });
   if(!tokenResult.ok)return json({status:"authentication_failed",http_status:tokenResult.status},503);
   const token=String((await tokenResult.json())?.access_token??"");
   if(!token)return json({status:"authentication_missing_token"},503);
   const auth={"authorization":"Bearer "+token};
   const listResponse=await fetch(host+"/restapi/v1.0/subscription",{
     headers:auth,signal:AbortSignal.timeout(12000)
   });
   if(!listResponse.ok)return json({status:"subscription_read_failed",http_status:listResponse.status},503);
   const list=await listResponse.json();
   const rows=(Array.isArray(list.records)?list.records:[]) as Record<string,unknown>[];
   const matching=rows.filter(relevant);
   if(matching.length>1)return json({status:"duplicate_matching_subscriptions",count:matching.length},409);
   if(matching.length===1){
     const sub=matching[0];
     const status=String(sub.status??"");
     if(status.toLowerCase()!=="active")return json({status:"subscription_not_active",provider_status:status},409);
     const expiresAt=Date.parse(String(sub.expirationTime??""));
     const seconds=Number(sub.expiresIn);
     const remaining=Number.isFinite(expiresAt)?(expiresAt-Date.now())/1000:(Number.isFinite(seconds)?seconds:NaN);
     if(!Number.isFinite(remaining))return json({status:"active_expiration_unverified"},200);
     if(remaining>48*3600)return json({status:"healthy",remaining_hours:Math.round(remaining/3600)});
     const subid=String(sub.id??"");
     if(!/^[a-z0-9-]{10,80}$/i.test(subid))return json({status:"invalid_subscription_id"},503);
     const renew=await fetch(host+"/restapi/v1.0/subscription/"+encodeURIComponent(subid)+"/renew",{
       method:"POST",headers:auth,signal:AbortSignal.timeout(12000)
     });
     if(!renew.ok){await renew.text();return json({status:"renew_failed",http_status:renew.status},503);}
     return json({status:"renewed"});
   }
   const random=crypto.getRandomValues(new Uint8Array(32));
   const verification=[...random].map((value)=>value.toString(16).padStart(2,"0")).join("");
   const sha=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(verification)));
   const hash=[...sha].map((value)=>value.toString(16).padStart(2,"0")).join("");
   const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
   const {data:record,error:recordError}=await admin.from("ringcentral_sms_webhook_token_hashes")
     .insert({token_sha256:hash,enabled:true,state:"pending"}).select("id").single();
   if(recordError||!record?.id)return json({status:"verification_digest_save_failed"},503);
   const creation=await fetch(host+"/restapi/v1.0/subscription",{
     method:"POST",
     headers:{"authorization":"Bearer "+token,"content-type":"application/json"},
     body:JSON.stringify({
       eventFilters:[FILTER],deliveryMode:{transportType:"WebHook",address:CALLBACK,verificationToken:verification},expiresIn:604799
     }),signal:AbortSignal.timeout(15000)
   });
   if(!creation.ok){
     const raw=await creation.json().catch(()=>({}));
     const code=String(raw?.errorCode??"").slice(0,40).replace(/[^a-zA-Z0-9_-]/g,"");
     const bracket=String(raw?.message??"").match(/\[([A-Za-z][A-Za-z0-9]{2,50})\]/);
     if(creation.status>=400 && creation.status<500)
       await admin.from("ringcentral_sms_webhook_token_hashes").update({state:"disabled",enabled:false}).eq("id",record.id);
     return json({status:"create_failed",http_status:creation.status,provider_error_code:code||null,missing_scope:bracket?.[1]??null},503);
   }
   const subscription=await creation.json();
   await admin.from("ringcentral_sms_webhook_token_hashes").update({state:"active",subscription_id:String(subscription.id??""),updated_at:new Date().toISOString()}).eq("id",record.id);
   if(!relevant(subscription)||String(subscription.status??"").toLowerCase()!=="active")
     return json({status:"created_requires_verification"},202);
   return json({status:"created",expiration_time:subscription.expirationTime??null});
 }catch(e){
   const why=e instanceof Error&&e.name==="TimeoutError"?"timeout":"provider_unavailable";
   return json({status:why},503);
 }
});