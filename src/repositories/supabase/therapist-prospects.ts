import {supabase} from '@/integrations/supabase/client';

export interface TherapistProspect {
  id:string;firstName:string|null;lastName:string|null;
  email:string|null;phone:string|null;linkedIn:string|null;
  licenseType:string|null;state:string|null;licensedStates:string[];
  contactable:boolean;exclusionReason:string|null;ownerProfileId:string|null;
  nextAction:string|null;nextActionDueAt:string|null;notes:string|null;
  version:number;status:'review'|'ready'|'blocked';
  createdAt:string;updatedAt:string;
}
export interface ProspectPage{items:TherapistProspect[];total:number;page:number;pageSize:number}
export interface ProspectEvent{
  when:string;actor:string;from:string|null;to:string;
  owner:string|null;reason:string;
}
/** Protected service-owned staging is exposed only through permission-checked,
 * tenant-matched RPCs. Never grant authenticated access to the source table. */
export async function listTherapistProspects(
  tenantId:string,page=1,pageSize=50,search='',prospectId?:string,stateFilter='',
):Promise<ProspectPage>{
  const {data,error}=await supabase.rpc('crm_list_therapist_prospects_filtered' as never,{
    p_tenant_id:tenantId,p_page:page,p_page_size:pageSize,
    p_search:search,p_prospect_id:prospectId??null,p_state:stateFilter||null,
  } as never);
  if(error)throw new Error(error.message);
  const result=data as unknown as ProspectPage|null;
  if(!result||!Array.isArray(result.items))throw new Error('Prospect list response was invalid.');
  return result;
}
export async function updateTherapistProspect(input:{
  tenantId:string;prospectId:string;expectedVersion:number;
  ownerProfileId:string|null;status:'review'|'ready'|'blocked';
  nextAction:string|null;nextActionDueAt:string|null;notes:string|null;reason:string;
}):Promise<number>{
  const {data,error}=await supabase.rpc('crm_update_therapist_prospect' as never,{
    p_tenant_id:input.tenantId,p_prospect_id:input.prospectId,
    p_expected_version:input.expectedVersion,p_owner_profile_id:input.ownerProfileId,
    p_status:input.status,p_next_action:input.nextAction,
    p_next_action_due_at:input.nextActionDueAt,p_notes:input.notes,p_reason:input.reason,
  } as never);
  if(error)throw new Error(error.message);
  if(typeof data!=='number')throw new Error('Prospect version was not returned.');
  return data;
}
export async function therapistProspectHistory(tenantId:string,prospectId:string):Promise<ProspectEvent[]>{
  const {data,error}=await supabase.rpc('crm_therapist_prospect_history' as never,{
    p_tenant_id:tenantId,p_prospect_id:prospectId,
  } as never);
  if(error)throw new Error(error.message);
  return Array.isArray(data)?data as ProspectEvent[]:[];
}
