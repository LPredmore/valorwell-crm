import {supabase} from '@/integrations/supabase/client';

export interface RecruitmentDraftStep{
 stepOrder?:number;delayDays:number;subject:string;bodyText:string;
}
export interface RecruitmentDraft{
 id:string;name:string;description:string;stateFilter:string|null;licenseFilter:string|null;
 status:'draft';updatedAt:string;steps:RecruitmentDraftStep[];
}
export interface RecruitmentDraftPreview{
 matched:number;formatValid:number;missing:number;invalid:number;suppressed:number;
 manuallyVerified:number;documentedPermission:number;technicallyReady:number;approvedForSending:0;
 sendingEnabled:false;notice:string;
}
export interface RecruitmentInboundReply{
 id:string;prospectId:string;prospectName:string;subject:string;
 classification:'opt_out'|'possible_interest'|'possible_decline'|'needs_review';
 reviewStatus:'pending'|'resolved'|'opted_out';decision:string|null;occurredAt:string;
}
/** None of these RPCs enqueue, enroll, schedule, or send messages. */
export async function listRecruitmentDrafts(tenantId:string):Promise<RecruitmentDraft[]>{
 const {data,error}=await supabase.rpc('crm_recruitment_draft_workspace' as never,{
  p_tenant_id:tenantId,
 } as never);
 if(error)throw new Error(error.message);
 if(!Array.isArray(data))throw new Error('Invalid recruitment sequence list');
 return data as RecruitmentDraft[];
}
export async function saveRecruitmentDraft(input:{
 tenantId:string;id:string|null;name:string;description:string;
 stateFilter:string;licenseFilter:string;steps:RecruitmentDraftStep[];
}):Promise<string>{
 const {data,error}=await supabase.rpc('crm_recruitment_save_draft' as never,{
  p_tenant_id:input.tenantId,p_sequence_id:input.id,
  p_name:input.name.trim(),p_description:input.description.trim(),
  p_state_filter:input.stateFilter.trim().toUpperCase()||null,
  p_license_filter:input.licenseFilter.trim()||null,
  p_steps:input.steps.map(s=>({
   delayDays:s.delayDays,subject:s.subject.trim(),bodyText:s.bodyText.trim(),
  })),
 } as never);
 if(error)throw new Error(error.message);
 if(typeof data!=='string'||!data)throw new Error('Draft sequence was not saved');
 return data;
}
export async function previewRecruitmentDraft(tenantId:string,id:string):Promise<RecruitmentDraftPreview>{
 const {data,error}=await supabase.rpc('crm_recruitment_draft_preview' as never,{
  p_tenant_id:tenantId,p_sequence_id:id,
 } as never);
 if(error)throw new Error(error.message);
 return data as unknown as RecruitmentDraftPreview;
}
export async function listRecruitmentReplies(tenantId:string):Promise<RecruitmentInboundReply[]>{
 const {data,error}=await supabase.rpc('crm_recruitment_reply_inbox' as never,{
  p_tenant_id:tenantId,
 } as never);
 if(error)throw new Error(error.message);
 if(!Array.isArray(data))throw new Error('Invalid clinician replies response');
 return data as RecruitmentInboundReply[];
}
export async function reviewRecruitmentReply(
 tenantId:string,replyId:string,decision:'interested'|'declined'|'ignore'|'opt_out',
):Promise<void>{
 const {data,error}=await supabase.rpc('crm_recruitment_review_reply' as never,{
  p_tenant_id:tenantId,p_reply_id:replyId,p_decision:decision,
 } as never);
 if(error)throw new Error(error.message);
 if(data!==true)throw new Error('Reply review was not confirmed');
}
