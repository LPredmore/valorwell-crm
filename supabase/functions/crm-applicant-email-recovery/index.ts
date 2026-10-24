import "jsr:@supabase/functions-js@2.4.5/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2";
import {sendTherapistInvite, type InviteRow} from "./therapistInvite.ts";
import {processApplicationReminders} from "./therapistReminders.ts";
const TENANT="00000000-0000-0000-0000-000000000001";
const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
 status,headers:{"content-type":"application/json","cache-control":"no-store"}
});
Deno.serve(async(req:Request)=>{
 if(req.method!=="POST")return respond({error:"method_not_allowed"},405);
 const expected=Deno.env.get("CRON_SECRET")??"";
 if(!expected||req.headers.get("x-cron-secret")!==expected)return respond({error:"unauthorized"},401);
 const url=Deno.env.get("SUPABASE_URL")??"";
 const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
 if(!url||!key)return respond({error:"database_not_configured"},503);
 const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:invites,error:inviteError}=await admin.from("therapist_application_invites")
  .select("id,email,status").eq("tenant_id",TENANT)
  .in("status",["pending","failed"])
  .lt("created_at",new Date(Date.now()-60000).toISOString())
  .order("created_at",{ascending:true}).limit(10);
 if(inviteError)return respond({error:"invite_queue_unavailable"},503);
 let sent=0,failed=0;
 for(const invite of (invites??[]) as InviteRow[]){
   const result=await sendTherapistInvite(admin,invite,null);
   if(result==="sent")sent++;else failed++;
 }
 try{
  const reminders=await processApplicationReminders(admin);
  return respond({ok:failed===0,initial_invites:{checked:invites?.length??0,sent,failed},reminders});
 }catch{
  return respond({ok:false,error:"reminder_recovery_failed",initial_invites:{checked:invites?.length??0,sent,failed}},503);
 }
});