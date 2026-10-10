import {supabase} from '@/integrations/supabase/client';
import type {ProspectPage,TherapistProspect} from './therapist-prospects';

export interface ReviewedProspect extends TherapistProspect{
  emailQuality:'missing'|'invalid'|'duplicate'|'valid';
  emailReviewStatus:'unverified'|'verified'|'invalid';
  phoneValid:boolean;duplicateEmailCount:number;suppressed:boolean;
  possibleApplicant:boolean;possibleContact:boolean;emailPreviewEligible:boolean;
}
export interface ReviewedProspectPage extends Omit<ProspectPage,'items'>{items:ReviewedProspect[]}
export interface RecruitmentPreview{
  total:number;review:number;ready:number;blocked:number;
  emailValid:number;emailMissing:number;emailInvalid:number;emailDuplicate:number;
  suppressed:number;possibleIdentityMatch:number;emailReviewed:number;technicallyReady:number;
  sendingEnabled:false;note:string;
}
export interface ApplicantMatch{ id:string;name:string;status:string;reason:string }
export interface ApplicantCandidates{linkedApplicantId:string|null;matches:ApplicantMatch[]}
export interface RecruitmentFilters{search?:string;state?:string;workflow?:string;quality?:string;due?:string;owner?:string}
export async function listRecruitmentReviewProspects(
 tenantId:string,page=1,pageSize=50,filters:RecruitmentFilters={},prospectId?:string,
):Promise<ReviewedProspectPage>{
 const {data,error}=await supabase.rpc('crm_recruitment_review_queue' as never,{
  p_tenant_id:tenantId,p_page:page,p_page_size:pageSize,
  p_search:filters.search??null,p_prospect_id:prospectId??null,p_state:filters.state??null,
  p_workflow:filters.workflow??null,p_quality:filters.quality??null,p_due:filters.due??null,
  p_owner:filters.owner?.trim()||null,
 } as never);
 if(error)throw new Error(error.message);
 const result=data as unknown as ReviewedProspectPage|null;
 if(!result||!Array.isArray(result.items))throw new Error('Invalid recruitment queue response');
 return result;
}
export async function getRecruitmentPreview(tenantId:string):Promise<RecruitmentPreview>{
 const {data,error}=await supabase.rpc('crm_recruitment_campaign_preview' as never,{p_tenant_id:tenantId} as never);
 if(error)throw new Error(error.message);
 return data as unknown as RecruitmentPreview;
}
export async function reviewProspectEmail(tenantId:string,prospectId:string,version:number,
 status:'unverified'|'verified'|'invalid',reason:string):Promise<number>{
 const {data,error}=await supabase.rpc('crm_review_therapist_prospect_email' as never,{
  p_tenant_id:tenantId,p_prospect_id:prospectId,p_expected_version:version,
  p_email_review_status:status,p_reason:reason,
 } as never);
 if(error)throw new Error(error.message);
 return data as unknown as number;
}
export async function getApplicantCandidates(tenantId:string,prospectId:string):Promise<ApplicantCandidates>{
 const {data,error}=await supabase.rpc('crm_recruitment_applicant_candidates' as never,{
  p_tenant_id:tenantId,p_prospect_id:prospectId,
 } as never);
 if(error)throw new Error(error.message);
 return data as unknown as ApplicantCandidates;
}
export async function linkExistingApplicant(tenantId:string,prospectId:string,applicantId:string,reason:string):Promise<void>{
 const {data,error}=await supabase.rpc('crm_recruitment_link_existing_applicant' as never,{
  p_tenant_id:tenantId,p_prospect_id:prospectId,p_applicant_id:applicantId,p_reason:reason,
 } as never);
 if(error)throw new Error(error.message);
 if(data!==true)throw new Error('Applicant link was not confirmed');
}
