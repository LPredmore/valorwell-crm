import {supabase} from '@/integrations/supabase/client';
import {requireApplicantSourceTransition} from '@/domain/pipelines/applicant-source-transitions';
import type {CrmPipeline} from '@/domain/pipelines/models';
import type {ConnectedPipelineCard} from './connected-pipeline-cards';

/** Reuse staff applicant's existing audited, idempotent, version-checked
 * update contract. Never directly update provider_applicants or generate
 * outbound contact/Approved->Invited activity from a generic drag gesture. */
export async function transitionApplicantPipelineCard(
  pipeline:CrmPipeline,card:ConnectedPipelineCard,toStatus:string,note:string,
):Promise<void>{
  if(pipeline.source_mode!=='connected'||pipeline.source_key!=='provider_applicants')
    throw new Error('Invalid provider-applicant pipeline.');
  const {data:staffTenant,error:scopeError}=await supabase.rpc(
    'crm_staff_tenant_for_applicant_pipeline' as never);
  if(scopeError||staffTenant!==pipeline.tenant_id)
    throw new Error('Selected CRM tenant is not the authorized staff applicant tenant.');
  requireApplicantSourceTransition(
    card.sourceStatus??'',toStatus,card.sourceVersion??null,card.owner_profile_id??null,
    card.next_action,card.next_action_due_at,note,
  );
  const {data,error}=await supabase.rpc('staff_update_provider_applicant' as never,{
    p_applicant_id:card.id,p_status:toStatus,p_owner_profile_id:card.owner_profile_id,
    p_next_action:card.next_action,p_next_action_due_at:card.next_action_due_at,
    p_note:note.trim(),p_prior_version:card.sourceVersion,
    p_client_action_id:crypto.randomUUID(),
  } as never);
  if(error)throw new Error(error.message);
  const result=data as {id?:string;version?:number}|null;
  if(result?.id!==card.id||result.version===card.sourceVersion)
    throw new Error('The staff workflow did not confirm the expected stage change. Refresh and retry.');
}
