import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "https://esm.sh/@supabase/supabase-js@2";
import {screeningInterviewEmail} from "./content.ts";

// Separate, disabled-by-default worker. Scheduled only by its own cron job.
// Even if called directly, SQL claim/eligibility requires admin-enabled
// campaign, submitted application, valid stage and no interview booking.
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"x-cron-secret,authorization,apikey,content-type"};
const json=(data:unknown,code=200)=>new Response(JSON.stringify(data),{
  status:code,headers:{...cors,"content-type":"application/json","cache-control":"no-store"}});
type Job={id:string;applicant_id:string;tenant_id:string;step:1|2|3|4;claim_token:string};
const errorCode=(s:string)=>s.replace(/[^a-zA-Z0-9_-]/g,"").slice(0,55);
const cleanEmail=(s:string)=>s.trim().toLowerCase();
async function run(){
 const supabaseUrl=Deno.env.get("SUPABASE_URL");
 const roleKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!supabaseUrl||!roleKey)throw Error("Database access is not configured");
 const db=createClient(supabaseUrl,roleKey,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:claimed,error:claimError}=await db.rpc("crm_claim_screening_interview_jobs",{p_limit:10});
 if(claimError)throw Error("Claim failed "+claimError.code);
 const summary={claimed:(claimed??[]).length,sent:0,skipped:0,failed:0};
 for(const job of (claimed??[]) as Job[]){
  try{
   const [{data:canSend,error:gateError},{data:applicant,error:applicantError},
      {data:control,error:controlError}]=await Promise.all([
     db.rpc("crm_screening_interview_can_send",{p_job_id:job.id,p_token:job.claim_token}),
     db.from("provider_applicants").select("id,email,first_name").eq("id",job.applicant_id)
       .eq("tenant_id",job.tenant_id).maybeSingle(),
     db.from("crm_resend_email_settings").select("from_email,from_name,reply_to_email,connection_status")
       .eq("tenant_id",job.tenant_id).maybeSingle()
   ]);
   if(gateError||applicantError||controlError)throw Error("Eligibility or email settings unavailable");
   if(canSend!==true||!applicant?.email){
    const {error}=await db.rpc("crm_finish_screening_interview_job",{
     p_job_id:job.id,p_claim_token:job.claim_token,p_outcome:"skipped",
     p_error_code:"candidate_no_longer_eligible"});
    if(error)throw Error("Skip state recording failed");
    summary.skipped++;continue;
   }
   if(control?.connection_status!=="connected"||!control.from_email)throw Error("Sender not configured");
   const secret=Deno.env.get("RESEND_API_KEY");
   if(!secret)throw Error("RESEND_API_KEY not configured");
   const copy=screeningInterviewEmail(job.step,applicant.first_name);
   const from=String(control.from_name??"ValorWell").replace(/[<>\r\n]/g,"").trim()
      +" <"+String(control.from_email).trim()+">";
   // Stable idempotency key allows safe retry after a transport acceptance.
   // Recheck stage and booking immediately before handing to Resend.
   const {data:stillEligible,error:recheckError}=await db.rpc("crm_screening_interview_can_send",{
       p_job_id:job.id,p_token:job.claim_token});
   if(recheckError)throw Error("Pre-send eligibility check failed");
   if(stillEligible!==true){
    const {error}=await db.rpc("crm_finish_screening_interview_job",{
      p_job_id:job.id,p_claim_token:job.claim_token,p_outcome:"skipped",
      p_error_code:"candidate_progressed"});
    if(error)throw Error("Skip state recording failed");
    summary.skipped++;continue;
   }
   const result=await fetch("https://api.resend.com/emails",{
    method:"POST",headers:{"Authorization":"Bearer "+secret,"Content-Type":"application/json",
      "Idempotency-Key":"screening-interview/"+job.id},
    body:JSON.stringify({
      from,reply_to:control.reply_to_email||"info@valorwell.org",
      to:[cleanEmail(applicant.email)],subject:copy.subject,text:copy.text,html:copy.html
    }),signal:AbortSignal.timeout(12000)
   });
   const data=await result.json().catch(()=>({})) as {id?:string};
   if(!result.ok||!data.id)throw Error("Resend transport "+result.status);
   const {data:finished,error:finishError}=await db.rpc("crm_finish_screening_interview_job",{
     p_job_id:job.id,p_claim_token:job.claim_token,p_outcome:"sent",p_message_id:data.id
   });
   if(finishError||finished!==true)throw Error("Provider accepted; database commit must be retried");
   summary.sent++;
  }catch(e){
   const reason=e instanceof Error?e.message:"unknown";
   console.error(JSON.stringify({function:"screening-interview-campaign",job_id:job.id,error:errorCode(reason)}));
   try{
    await db.rpc("crm_finish_screening_interview_job",{
      p_job_id:job.id,p_claim_token:job.claim_token,p_outcome:"failed",
      p_error_code:errorCode(reason)
    });
   }catch{ /* stale processing claim is lease-retryable */ }
   summary.failed++;
  }
 }
 return summary;
}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 const expected=Deno.env.get("CRON_SECRET");
 if(!expected||req.headers.get("X-Cron-Secret")!==expected)
  return json({error:"Unauthorized"},401);
 try{return json({ok:true,summary:await run()});}
 catch(e){console.error("Screening interview campaign worker failure",e instanceof Error?e.name:"unknown");
  return json({ok:false,error:"Worker unavailable"},500);}
});
