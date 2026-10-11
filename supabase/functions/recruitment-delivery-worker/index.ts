import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "https://esm.sh/@supabase/supabase-js@2";
import {
 canAttemptDelivery,classifyResendResponse,normalizeEmail,taggedReplyTo,
 renderRecruitmentEmail,type RecruitmentClaim,type SendResponse,
} from "./delivery-utils.ts";

const respond=(data:unknown,status=200)=>new Response(JSON.stringify(data),{
 status,headers:{"content-type":"application/json","cache-control":"no-store"},
});
type Db=ReturnType<typeof createClient>;
async function rpc<T>(db:Db,name:string,args:Record<string,unknown>):Promise<T>{
 const {data,error}=await db.rpc(name,args);
 if(error)throw new Error(`${name}: ${error.message}`);
 return data as T;
}
const workerId=crypto.randomUUID();
Deno.serve(async(req:Request)=>{
 if(req.method!=="POST")return respond({error:"Method not allowed"},405);
 const secret=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
 const token=req.headers.get("authorization")??"";
 // No CRM user/browser capability or arbitrary cron secret can send.
 if(!secret||token!==`Bearer ${secret}`)return respond({error:"Unauthorized"},403);
 const supabaseUrl=Deno.env.get("SUPABASE_URL")??"";
 if(!supabaseUrl)return respond({error:"Runtime misconfigured"},503);
 const db=createClient(supabaseUrl,secret,{auth:{persistSession:false}});
 const input=await req.json().catch(()=>({})) as {action?:string;limit?:number};
 if(input.action!=="run"&&input.action!=="status")return respond({error:"Unknown action"},400);
 // A SECOND independent runtime switch. In addition, the database disallows
 // execution_enabled/approved_test_only by CHECK, and there is NO cron.
 const runtimeEnabled=Deno.env.get("RECRUITMENT_WORKER_EXECUTION")==="enabled";
 const {data:controls,error:controlError}=await db.from("crm_recruitment_send_control")
  .select("tenant_id,execution_enabled,approved_test_only,max_per_run").limit(100);
 if(controlError)return respond({error:"Control check unavailable"},503);
 const databaseEnabled=!!controls?.some(c=>c.execution_enabled===true&&c.approved_test_only===true);
 if(input.action==="status")return respond({
  mode:"status",runtimeEnabled,databaseEnabled,sendEnabled:runtimeEnabled&&databaseEnabled,
  cronRegistered:false,workerId,
 });
 if(!runtimeEnabled||!databaseEnabled)return respond({
  mode:"disabled",claimed:0,sent:0,reason:"Two independent send controls remain OFF.",
 });
 const apiKey=Deno.env.get("RESEND_API_KEY")??"";
 if(!apiKey)return respond({error:"Resend API configuration required"},503);
 const baseUrl=(Deno.env.get("RECRUITMENT_UNSUBSCRIBE_BASE_URL")??
  `${supabaseUrl}/functions/v1/recruitment-unsubscribe`).trim();
 if(!baseUrl.startsWith("https://"))return respond({error:"Secure unsubscribe base URL required"},503);
 const limit=Math.max(1,Math.min(5,Number(input.limit??3)||3));
 const outcomes:Array<{stepId:string;state:string}>=[];
 try{
  await rpc<number>(db,"crm_recruitment_worker_reap_expired",{});
  const claimed=await rpc<RecruitmentClaim[]>(db,"crm_recruitment_worker_claim",{
   p_limit:limit,p_lease_seconds:180,
  });
  for(const item of claimed){
   let outcome:"accepted"|"retry"|"uncertain"|"failed"="uncertain";
   let providerId:string|null=null;
   let errorCode:string|null=null;
   let attemptedProvider=false;
   try{
    const {data:control}=await db.from("crm_recruitment_send_control")
     .select("execution_enabled,approved_test_only").eq("tenant_id",item.tenantId).single();
    const stillEnabled=!!control?.execution_enabled&&!!control?.approved_test_only;
    const checked=await rpc<boolean>(db,"crm_recruitment_worker_recheck",{
     p_tenant_id:item.tenantId,p_step_id:item.stepId,p_lease_token:item.leaseToken,
    });
    if(!canAttemptDelivery({runtimeEnabled,databaseEnabled:stillEnabled,claimValid:checked})){
     outcome="failed";errorCode="preflight_revoked";
    }else{
     const rawToken=await rpc<string>(db,"crm_recruitment_worker_issue_unsubscribe_token",{
      p_tenant_id:item.tenantId,p_step_id:item.stepId,p_lease_token:item.leaseToken,
     });
     const unsubscribeUrl=`${baseUrl}?token=${encodeURIComponent(rawToken)}`;
     const message=renderRecruitmentEmail({
      body:item.bodyText,postalAddress:item.postalAddress,unsubscribeUrl,
     });
     const sender=normalizeEmail(item.fromEmail);
     const recipient=normalizeEmail(item.to);
     const replyTo=taggedReplyTo(item.replyTo,item.emailMessageId);
     // Recheck immediately before the network boundary; if stopped, skip.
     const finalPreflight=await rpc<boolean>(db,"crm_recruitment_worker_recheck",{
      p_tenant_id:item.tenantId,p_step_id:item.stepId,p_lease_token:item.leaseToken,
     });
     if(!finalPreflight){outcome="failed";errorCode="delivery_revoked";}
     else{
      attemptedProvider=true;
      const response=await fetch("https://api.resend.com/emails",{
       method:"POST",headers:{
        authorization:`Bearer ${apiKey}`,"content-type":"application/json",
        "idempotency-key":item.idempotencyKey,
        "user-agent":"ValorWell-CRM-Recruitment/1.0",
       },
       body:JSON.stringify({
        from:item.fromName?`${String(item.fromName).replace(/[<>\r\n]/g,"").trim()} <${sender}>`:sender,
        to:[recipient],reply_to:replyTo,subject:item.subject,
        text:message.text,html:message.html,
        headers:{"List-Unsubscribe":`<${unsubscribeUrl}>`,"List-Unsubscribe-Post":"List-Unsubscribe=One-Click",
        "X-CRM-Email-Message-ID":item.emailMessageId},
       }),
      });
      const payload=await response.json().catch(()=>null) as SendResponse|null;
      outcome=classifyResendResponse(response.status,payload);
      providerId=outcome==="accepted"?String(payload?.id??""):null;
      errorCode=outcome==="accepted"?null:
       String(payload?.name??`http_${response.status}`).slice(0,120);
     }
    }
   }catch(error){
    outcome=attemptedProvider?"uncertain":"failed";
    errorCode=attemptedProvider?"provider_outcome_unknown":"preflight_exception";
    // Do not log recipient addresses, content, provider keys, or unsubscribe token.
    console.error(JSON.stringify({component:"recruitment-worker",stepId:item.stepId,
     outcome,errorCode,message:error instanceof Error?error.name:"unknown"}));
   }
   try{
    const committed=await rpc<{state:string}>(db,"crm_recruitment_worker_finalize",{
     p_tenant_id:item.tenantId,p_step_id:item.stepId,p_lease_token:item.leaseToken,
     p_outcome:outcome,p_provider_message_id:providerId,p_error:errorCode,
    });
    outcomes.push({stepId:item.stepId,state:committed.state});
   }catch(error){
    // The lease may have been cancelled by an inbound reply/suppression.
    // Do NOT re-send merely because recording the provider result failed.
    outcomes.push({stepId:item.stepId,state:"reconciliation_required"});
    console.error(JSON.stringify({component:"recruitment-worker",stepId:item.stepId,
     outcome:"finalize_failed",error:error instanceof Error?error.name:"unknown"}));
   }
  }
 }catch(error){
  console.error(JSON.stringify({component:"recruitment-worker",outcome:"worker_error",
   error:error instanceof Error?error.name:"unknown"}));
  return respond({error:"Recruitment worker could not complete safely",outcomes},503);
 }
 return respond({mode:"processed",outcomes,claimed:outcomes.length});
});
