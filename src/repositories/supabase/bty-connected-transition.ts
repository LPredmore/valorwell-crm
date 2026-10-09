import {supabase} from '@/integrations/supabase/client';
import {requireBtySourceTransition} from '@/domain/pipelines/bty-source-transitions';
import type {CrmPipeline} from '@/domain/pipelines/models';
import type {ConnectedPipelineCard} from './connected-pipeline-cards';

/** Calls the EXISTING audited BTY source transition function. CRM never
 * duplicates the source status into crm_pipeline_records or fakes outreach.
 * Auth, tenant, version, allowed transitions and activity are server-checked. */
export async function transitionBtyPipelineCard(
  pipeline:CrmPipeline,record:ConnectedPipelineCard,toStatus:string,reason:string,
):Promise<void>{
  if(pipeline.source_mode!=='connected'||pipeline.source_key!=='relationship_opportunities')
    throw new Error('This pipeline is not connected to the BTY opportunity workflow.');
  if(!record.sourceStatus||record.sourceVersion===undefined)
    throw new Error('This source card does not include a verifiable status/version. Reload the board.');
  requireBtySourceTransition(record.sourceStatus,toStatus,reason,record.sourceVersion);
  const {data,error}=await supabase.rpc('transition_relationship_opportunity_status',{
    p_opportunity_id:record.id,p_status:toStatus,p_reason:reason.trim(),
    p_expected_version:record.sourceVersion,p_changed_at:new Date().toISOString(),
  });
  if(error)throw new Error(error.message);
  if(!data||data.tenant_id!==pipeline.tenant_id||data.status!==toStatus)
    throw new Error('The source did not confirm the expected change. Refresh before proceeding.');
}
