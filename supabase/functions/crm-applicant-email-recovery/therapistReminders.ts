// Email reminders for fresh, consented interest submissions. The initial
// invitation is sent by therapistInvite.ts, not duplicated here.
// The database RPC only claims rows from new interests during
// 06:00-18:00 America/Chicago. Old interview jobs remain untouched.
import type {SupabaseClient} from "npm:@supabase/supabase-js@2";
import {applicationReminderContent} from "./therapistReminderContent.ts";

type Claimed = {id:string;tenant_id:string;invite_id:string;step:2|3|4;claim_token:string};
const safeError = (reason:string) => reason.replace(/[^a-zA-Z0-9_-]/g,"").slice(0,60);
const normalizeEmail=(email:unknown)=>String(email??"").trim().toLowerCase();
async function setOutcome(db:SupabaseClient,job:Claimed,status:"sent"|"failed"|"skipped",info?:string,providerId?:string) {
 const patch:Record<string,unknown>={status,claim_token:null,claimed_at:null,updated_at:new Date().toISOString()};
 if(status==="sent"){patch.sent_at=new Date().toISOString();patch.provider_message_id=providerId??null;patch.error_code=null;}
 else if(status==="failed"){patch.error_code=safeError(info??"transport_failed");patch.scheduled_for=new Date(Date.now()+15*60*1000).toISOString();}
 else patch.error_code=safeError(info??"application_started");
 const {data,error}=await db.from("therapist_application_reminder_jobs").update(patch)
   .eq("id",job.id).eq("tenant_id",job.tenant_id)
   .eq("status","processing").eq("claim_token",job.claim_token).select("id").maybeSingle();
 if(error||!data)throw new Error("Reminder outcome update failed.");
}
export async function processApplicationReminders(db:SupabaseClient):Promise<{claimed:number;sent:number;skipped:number;failed:number}> {
 const {data:claimed,error}=await db.rpc("crm_claim_therapist_application_reminders",{p_limit:10});
 if(error) throw new Error("Reminder claim failed: "+error.code);
 const jobs=(claimed??[]) as Claimed[];
 const results={claimed:jobs.length,sent:0,skipped:0,failed:0};
 const apiKey=Deno.env.get("RESEND_API_KEY")??"";
 for(const job of jobs) {
   try {
     const {data:invite,error:inviteError}=await db.from("therapist_application_invites")
       .select("id,email,submission_id,campaign_enrolled,status")
       .eq("id",job.invite_id).eq("tenant_id",job.tenant_id).maybeSingle();
     if(inviteError||!invite||!invite.campaign_enrolled||invite.status!=="sent"){
       await setOutcome(db,job,"skipped","source_not_eligible");results.skipped++;continue;
     }
     const email=normalizeEmail(invite.email);
     // Double-check before transport: beginning the application ends reminders.
     const [{count:started,error:startError},{data:source,error:sourceError}]=await Promise.all([
       db.from("therapist_applications").select("id",{head:true,count:"exact"})
         .eq("tenant_id",job.tenant_id).eq("email",email),
       db.from("website_submissions").select("payload,consent")
         .eq("id",invite.submission_id).eq("tenant_id",job.tenant_id).maybeSingle(),
     ]);
     if(startError||sourceError)throw new Error("eligibility_read_failed");
     if((started??0)>0||source?.consent!==true||source?.payload?.source!=="clinician_interest_form"
        ||normalizeEmail(source?.payload?.email)!==email){
       await setOutcome(db,job,"skipped","started_or_ineligible");results.skipped++;continue;
     }
     if(!apiKey)throw new Error("email_unconfigured");
     const contents=applicationReminderContent(job.step,source?.payload?.first_name??null);
     const response=await fetch("https://api.resend.com/emails",{
       method:"POST",
       headers:{"Authorization":"Bearer "+apiKey,"Content-Type":"application/json",
         "Idempotency-Key":"therapist-application-reminder/"+job.id},
       body:JSON.stringify({from:"ValorWell <noreply@valorwell.org>",reply_to:"info@valorwell.org",
         to:[email],subject:contents.subject,html:contents.html,text:contents.text}),
       signal:AbortSignal.timeout(12000)
     });
     const provider=await response.json().catch(()=>({})) as {id?:string};
     if(!response.ok||!provider.id)throw new Error("email_http_"+response.status);
     await setOutcome(db,job,"sent",undefined,provider.id);
     results.sent++;
   }catch(err){
     const reason=err instanceof Error?err.message:"unexpected";
     console.error(JSON.stringify({fn:"therapist-application",stage:"followup",job_id:job.id,error:safeError(reason)}));
     try{await setOutcome(db,job,"failed",reason)}catch{ /* reclaim after lease expiry */ }
     results.failed++;
   }
 }
 return results;
}
