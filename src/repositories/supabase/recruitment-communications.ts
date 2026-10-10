import {supabase} from '@/integrations/supabase/client';

export type RecruitmentStage='not_contacted'|'contact_attempted'|'replied'|'interested'|'application_handoff'|'applicant_linked'|'closed';
export type RecruitmentChannel='email'|'sms'|'phone'|'linkedin'|'meeting'|'other'|'internal';
export type RecruitmentOutcome='attempted'|'responded'|'interested'|'not_interested'|'handoff'|'note';
export type RecruitmentDirection='outbound'|'inbound'|'internal';
export interface RecruitmentTimelineEntry{
 at:string;id:string;source:'crm_change'|'manual_activity'|'applicant_email'|'applicant_activity'|'relationship_email';
 channel:string;direction:string;status:string;subject:string;summary:string;threadId:string|null;
}
export interface RecruitmentContactInput{
 tenantId:string;prospectId:string;expectedVersion:number;
 channel:RecruitmentChannel;direction:RecruitmentDirection;outcome:RecruitmentOutcome;
 summary:string;newStage:RecruitmentStage;clientActionId:string;
}
export async function getRecruitmentTimeline(tenantId:string,prospectId:string):Promise<RecruitmentTimelineEntry[]>{
 const {data,error}=await supabase.rpc('crm_recruitment_communication_timeline' as never,{
  p_tenant_id:tenantId,p_prospect_id:prospectId,p_limit:80,
 } as never);
 if(error)throw new Error(error.message);
 if(!Array.isArray(data))throw new Error('Timeline response invalid');
 return data as RecruitmentTimelineEntry[];
}
/** Records what a staff member reports already happened. Never sends or enqueues a message. */
export async function logRecruitmentContact(input:RecruitmentContactInput):Promise<{eventId:string;version:number;alreadyRecorded:boolean}>{
 const {data,error}=await supabase.rpc('crm_recruitment_log_contact' as never,{
  p_tenant_id:input.tenantId,p_prospect_id:input.prospectId,p_expected_version:input.expectedVersion,
  p_channel:input.channel,p_direction:input.direction,p_outcome:input.outcome,
  p_summary:input.summary.trim(),p_occurred_at:null,p_new_stage:input.newStage,
  p_client_action_id:input.clientActionId,
 } as never);
 if(error)throw new Error(error.message);
 const result=data as unknown as {eventId?:string;version?:number;alreadyRecorded?:boolean}|null;
 if(!result?.eventId||typeof result.version!=='number')throw new Error('Contact event was not confirmed');
 return {eventId:result.eventId,version:result.version,alreadyRecorded:result.alreadyRecorded===true};
}
