import "jsr:@supabase/functions-js@2.4.5/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.93.1";
Deno.serve(async (req:Request)=>{
  const send=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
  if(req.method!=="POST")return send({error:"method_not_allowed"},405);
  const expected=Deno.env.get("CRON_SECRET")??"";
  if(!expected||req.headers.get("x-cron-secret")!==expected)return send({error:"unauthorized"},401);
  const url=Deno.env.get("SUPABASE_URL")??"";
  const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
  if(!url||!key)return send({error:"crm_unavailable"},503);
  const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await admin.rpc("autonomous_inbox_process_approved_v1",{p_limit:25});
  if(error)return send({ok:false,error:"action_verification_unavailable"},503);
  return send({ok:true,action_results:data,outbound_messages_sent:0});
});