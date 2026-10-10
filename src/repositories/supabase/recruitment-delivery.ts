import {supabase} from '@/integrations/supabase/client';

export type RecruitmentPermissionStatus='unknown'|'approved'|'revoked';
export interface RecruitmentContactPermission{
 emailPermission:RecruitmentPermissionStatus;
 evidenceSource:string|null;evidenceDetails:string|null;
 reviewedAt:string|null;reviewedBy:string|null;
}
export interface RecruitmentGate{
 sequenceId:string;prospectId:string;email:string;
 canCreateHeldPlan:boolean;canSend:false;sendingEnabled:false;reasons:string[];
}
export interface RecruitmentStepSchedule{
 stepNumber:number;daysAfterPrevious:number;subject:string;plannedFor:string;
}
export interface RecruitmentSchedulePreview{
 status:'preview_only';sendingEnabled:false;schedule:RecruitmentStepSchedule[];
}
export interface RecruitmentLedgerStep{
 planId:string;prospectId:string;sequenceId:string;
 stepNumber:number;dueAt:string;state:string;
 stoppedReason:string|null;attemptCount:number;
 providerMessageId:string|null;emailMessageId:string|null;lastError:string|null;
}
export interface RecruitmentDeliveryLedger{
 sendingEnabled:false;totalPlans:number;heldSteps:number;stoppedSteps:number;
 deliveredSteps:number;bouncedSteps:number;complainedSteps:number;items:RecruitmentLedgerStep[];
}
async function call<T>(fn:string,params:Record<string,unknown>):Promise<T>{
 const {data,error}=await supabase.rpc(fn as never,params as never);
 if(error)throw new Error(error.message);
 return data as T;
}
/** Read only. A pass permits HELD plan creation, not provider delivery. */
export function getRecruitmentDeliveryGate(tenantId:string,sequenceId:string,prospectId:string){
 return call<RecruitmentGate>('crm_recruitment_delivery_gate',{
  p_tenant_id:tenantId,p_sequence_id:sequenceId,p_prospect_id:prospectId,
 });
}
export function getRecruitmentContactPermission(tenantId:string,prospectId:string){
 return call<RecruitmentContactPermission>('crm_recruitment_contact_permission_status',{
  p_tenant_id:tenantId,p_prospect_id:prospectId,
 });
}
/** Human evidence recording; this cannot activate campaign sending. */
export async function recordRecruitmentContactPermission(input:{
 tenantId:string;prospectId:string;status:RecruitmentPermissionStatus;
 evidenceSource:string;evidenceDetails:string;
}):Promise<void>{
 const ok=await call<boolean>('crm_recruitment_record_contact_permission',{
  p_tenant_id:input.tenantId,p_prospect_id:input.prospectId,
  p_status:input.status,p_evidence_source:input.evidenceSource,
  p_evidence_details:input.evidenceDetails,
 });
 if(ok!==true)throw new Error('Contact permission change was not confirmed');
}
export function getRecruitmentSchedulePreview(tenantId:string,sequenceId:string){
 return call<RecruitmentSchedulePreview>('crm_recruitment_sequence_schedule_preview',{
  p_tenant_id:tenantId,p_sequence_id:sequenceId,p_start_at:null,
 });
}
export function getRecruitmentDeliveryLedger(tenantId:string,sequenceId:string){
 return call<RecruitmentDeliveryLedger>('crm_recruitment_delivery_ledger',{
  p_tenant_id:tenantId,p_sequence_id:sequenceId,
 });
}
/** Creates delivery snapshots solely with state=HELD. No API can send them. */
export function stageRecruitmentHeldPlan(tenantId:string,sequenceId:string,prospectId:string){
 return call<{planId:string;stepCount:number;state:'held';sendingEnabled:false}>(
 'crm_recruitment_stage_held_plan',{
  p_tenant_id:tenantId,p_sequence_id:sequenceId,p_prospect_id:prospectId,p_start_at:null,
 });
}

export const recruitmentGateReasonLabels:Record<string,string>={
 invalid_or_missing_email:'Missing or malformed email address',
 duplicate_identity:'Another prospect uses the same email',
 email_identity_unverified:'Email identity has not been manually verified',
 contact_permission_not_approved:'Documented contact permission is not approved',
 not_initial_outreach_stage:'Prospect is not Ready / Not Yet Contacted',
 source_excluded:'Prospect excluded by its source record',
 state_filter_mismatch:'Outside the selected state audience',
 license_filter_mismatch:'Outside the selected license audience',
 suppressed_or_do_not_contact:'Suppressed or marked do not contact',
 reply_already_received:'An inbound reply is already recorded',
 applicant_already_linked:'The prospect already has an application',
 already_planned:'A plan already exists for this sequence and prospect',
 prior_delivery_failure:'A prior email bounced, failed, or was suppressed',
 recruitment_bounce_or_complaint:'A recruitment message bounced or was complained about',
};
