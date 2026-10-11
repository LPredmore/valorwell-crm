import {supabase} from '@/integrations/supabase/client';

export interface RecruitmentEmailProposal {
 id:string;prospectId:string;email:string;sourceUrl:string;notes:string;
 status:'pending'|'approved'|'rejected';createdAt:string;
 reviewedAt:string|null;reviewNotes:string|null;
}
async function invoke<T>(fn:string,args:Record<string,unknown>):Promise<T>{
 const {data,error}=await supabase.rpc(fn as never,args as never);
 if(error)throw new Error(error.message);
 return data as T;
}
export async function getRecruitmentEnrichment(tenantId:string,prospectId:string):Promise<RecruitmentEmailProposal[]>{
 const result=await invoke<unknown>('crm_recruitment_email_enrichment_queue',{
  p_tenant_id:tenantId,p_prospect_id:prospectId,
 });
 if(!Array.isArray(result))throw new Error('Invalid enrichment queue response');
 return result as RecruitmentEmailProposal[];
}
export async function proposeRecruitmentEmail(input:{
 tenantId:string;prospectId:string;email:string;sourceUrl:string;notes:string;
}):Promise<string>{
 const result=await invoke<unknown>('crm_recruitment_propose_email_enrichment',{
  p_tenant_id:input.tenantId,p_prospect_id:input.prospectId,
  p_email:input.email.trim().toLowerCase(),p_source_url:input.sourceUrl.trim(),
  p_evidence_notes:input.notes.trim(),
 });
 if(typeof result!=='string')throw new Error('Email proposal was not confirmed');
 return result;
}
export async function reviewRecruitmentEmail(input:{
 tenantId:string;proposalId:string;decision:'approved'|'rejected';notes:string;
}):Promise<void>{
 const result=await invoke<boolean>('crm_recruitment_review_email_enrichment',{
  p_tenant_id:input.tenantId,p_proposal_id:input.proposalId,
  p_decision:input.decision,p_review_notes:input.notes.trim(),
 });
 if(result!==true)throw new Error('Review decision not confirmed');
}
