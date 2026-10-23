import {supabase} from '@/integrations/supabase/client';
import {requireApplicantSourceTransition} from '@/domain/pipelines/applicant-source-transitions';
import type {CrmPipeline} from '@/domain/pipelines/models';
import type {ConnectedPipelineCard} from './connected-pipeline-cards';

/** Respect authoritative staff ACLs and optimistic versioning. No generic
 * applicant update can create a hired staff member or an onboarding invite. */
export async function transitionApplicantPipelineCard(
  pipeline:CrmPipeline,card:ConnectedPipelineCard,toStatus:string,note:string,
):Promise<void>{
  if(pipeline.source_mode!=='connected'||pipeline.source_key!=='provider_applicants')
    throw new Error('Invalid provider-applicant pipeline.');
  const {data:staffTenant,error:scopeError}=await supabase.rpc(
    'crm_staff_tenant_for_applicant_pipeline' as never);
  if(scopeError||staffTenant!==pipeline.tenant_id)
    throw new Error('Selected CRM tenant is not the authorized staff applicant tenant.');
  const current=card.sourceStatus??'';
  requireApplicantSourceTransition(
    current,toStatus,card.sourceVersion??null,card.owner_profile_id??null,
    card.next_action,card.next_action_due_at,note,
  );
  const clientActionId=crypto.randomUUID();
  const interviewStageChange =
    (current==='screening'&&toStatus==='interview_invited')
    || (current==='interview_scheduled'&&['interview_completed','accepted'].includes(toStatus))
    || (current==='interview_completed'&&toStatus==='accepted');
  const {data,error}=interviewStageChange
    ?await supabase.rpc('crm_record_applicant_interview_stage' as never,{
      p_applicant_id:card.id,p_to_status:toStatus,p_prior_version:card.sourceVersion,
      p_client_action_id:clientActionId,p_note:note.trim(),
    } as never)
    :await supabase.rpc('staff_update_provider_applicant' as never,{
      p_applicant_id:card.id,p_status:toStatus,p_owner_profile_id:card.owner_profile_id,
      p_next_action:card.next_action,p_next_action_due_at:card.next_action_due_at,
      p_note:note.trim(),p_prior_version:card.sourceVersion,
      p_client_action_id:clientActionId,
    } as never);
  if(error)throw new Error(error.message);
  const result=data as {id?:string;version?:number}|null;
  if(result?.id!==card.id||result.version===card.sourceVersion)
    throw new Error('The applicant stage change was not confirmed. Refresh and retry.');
}
