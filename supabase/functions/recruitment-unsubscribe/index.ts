import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "https://esm.sh/@supabase/supabase-js@2";

const page=(message:string,status=200,token?:string)=>{
 const escape=(s:string)=>s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
 const form=token?`<form method="post" action="?token=${encodeURIComponent(token)}"><button style="background:#1e4d3a;color:white;padding:12px 20px;border:0;border-radius:6px;cursor:pointer">Unsubscribe me</button></form>`:"";
 return new Response(`<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width"/><meta name="robots" content="noindex,nofollow"/><title>ValorWell recruitment email preferences</title></head><body style="max-width:580px;margin:50px auto;padding:24px;font-family:Arial,sans-serif;color:#163b2b"><h1>Email preferences</h1><p>${escape(message)}</p>${form}</body></html>`,{
  status,headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","referrer-policy":"no-referrer","x-content-type-options":"nosniff"},
 });
};
Deno.serve(async(req:Request)=>{
 if(req.method!=="GET"&&req.method!=="POST")return page("Method not allowed",405);
 const token=new URL(req.url).searchParams.get("token")??"";
 if(!/^[0-9a-f]{48}$/.test(token))return page("This unsubscribe link is invalid.",404);
 if(req.method==="GET"){
  return page("If you no longer want clinician recruitment emails from ValorWell, select Unsubscribe me below.",200,token);
 }
 const url=Deno.env.get("SUPABASE_URL")??"";
 const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
 if(!url||!key)return page("We cannot process this request right now. Please contact ValorWell.",503);
 try{
  const db=createClient(url,key,{auth:{persistSession:false}});
  const {data,error}=await db.rpc("crm_recruitment_worker_unsubscribe",{p_token:token});
  if(error)throw new Error(error.message);
  if(data==="unsubscribed"||data==="already_unsubscribed")
   return page("Your clinician recruitment email subscription has been stopped.",200);
  if(data==="expired_token")return page("This unsubscribe link has expired. Contact ValorWell to opt out.",410);
  return page("This unsubscribe link is invalid.",404);
 }catch{
  return page("We could not process your request. Please contact ValorWell directly.",503);
 }
});
