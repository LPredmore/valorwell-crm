import { supabase } from '@/integrations/supabase/client';
import { getPipelineCardSubjects } from './pipeline-subjects';
import type { CrmPipeline, CrmPipelineStage, CrmPipelineRecord } from '@/domain/pipelines/models';

export interface ConnectedPipelineCard {
  id: string;
  stage_id: string;
  field_values: Record<string,unknown>;
  created_at: string;
  updated_at: string;
  next_action: string|null;
  next_action_due_at: string|null;
  displayName: string;
  primaryContact?: string;
  sourceUrl?: string;
  sourceStatus?: string;
  sourceVersion?: number;
  owner_profile_id?: string|null;
}

const batchSize=250;
const maxRows=2000;

/** Fetch only source-authorized rows, never insert copies of clinical/credentialing
 * data into CRM-owned relationship tables or manufacture source statuses. */
async function pages<T>(makeQuery:(from:number,to:number)=>PromiseLike<{data:T[]|null;error:{message:string}|null}>):Promise<T[]>{
  const out:T[]=[];
  for(let offset=0;offset<maxRows;offset+=batchSize){
    const {data,error}=await makeQuery(offset,offset+batchSize-1);
    if(error)throw new Error(error.message);
    const rows=data??[];
    out.push(...rows);
    if(rows.length<batchSize)break;
  }
  return out;
}

function mapName(...parts:(string|null|undefined)[]):string{
  return parts.filter(Boolean).join(' ').trim()||'Unnamed person';
}

export async function listConnectedPipelineCards(
  pipeline:CrmPipeline,stages:CrmPipelineStage[],
):Promise<ConnectedPipelineCard[]>{
  if(pipeline.source_mode!=='connected'||!pipeline.source_key)return [];
  const byKey=new Map(stages.filter(s=>s.source_stage_key).map(s=>[s.source_stage_key!,s.id] as const));
  const stage=(key:string)=>byKey.get(key);
  const tenantId=pipeline.tenant_id;
  const cards:ConnectedPipelineCard[]=[];
  if(pipeline.source_key==='provider_applicants'){
    // The staff RPC is scoped to its OWN tenant, which can differ from the
    // selected CRM tenant. Check equality before returning any applicant.
    const {data:staffTenant,error:tenantError}=await supabase.rpc('crm_staff_tenant_for_applicant_pipeline' as never);
    if(tenantError)throw new Error('Staff tenant authorization failed: '+tenantError.message);
    if(staffTenant!==tenantId)throw new Error('Staff applicant tenant and selected CRM tenant do not match.');
    // Provider applicants use the staff-authorized contract, not a broad CRM
    // SELECT policy on their protected application records.
    type Applicant={id:string;firstName:string;lastName:string;status:string;source:string;
      primaryState:string|null;licenseType:string|null;referralSource:string|null;
      nextAction:string|null;nextActionDueAt:string|null;createdAt:string;lastActivityAt:string|null;
      ownerProfileId:string|null;version:number};
    for(let page=1;page<=20;page++){
      const {data,error}=await supabase.rpc('staff_list_provider_applicants' as never,{
        p_status:null,p_search:null,p_page:page,p_page_size:100,
      } as never);
      if(error)throw new Error('Provider applicant listing requires authorized staff access: '+error.message);
      const result=data as {items?:Applicant[]}|null;
      const items=result?.items??[];
      for(const row of items){
        if(['hired','declined','withdrawn','no_response','inactive'].includes(row.status))continue;
        const sourceStage=row.status==='new'&&row.source==='website'?'website_new'
          :row.status==='credentialing'?'application':row.status;
        const id=stage(sourceStage);
        if(!id)continue;
        cards.push({id:row.id,stage_id:id,displayName:mapName(row.firstName,row.lastName),
          field_values:{license_type:row.licenseType,primary_state:row.primaryState,source:row.source},
          created_at:row.createdAt,updated_at:row.lastActivityAt??row.createdAt,
          next_action:row.nextAction,next_action_due_at:row.nextActionDueAt,
          sourceStatus:row.status,sourceVersion:row.version,owner_profile_id:row.ownerProfileId,
          sourceUrl:'https://emr.valorwell.org/staff/provider-applicants'});
      }
      if(items.length<100)break;
    }
  }else if(pipeline.source_key==='staff'){
    const roles=await supabase.from('staff_roles').select('id').eq('code','CLINICIAN');
    if(roles.error)throw new Error(roles.error.message);
    const ids=(roles.data??[]).map(r=>r.id);
    if(!ids.length)return [];
    const assigned=await supabase.from('staff_role_assignments').select('staff_id')
      .eq('tenant_id',tenantId).in('staff_role_id',ids);
    if(assigned.error)throw new Error(assigned.error.message);
    const staffIds=[...new Set((assigned.data??[]).map(x=>x.staff_id))];
    if(!staffIds.length)return [];
    const {data,error}=await supabase.from('staff').select('id,prov_name_f,prov_name_l,prov_status,prov_field,prov_state,created_at,updated_at')
      .eq('tenant_id',tenantId).in('id',staffIds);
    if(error)throw new Error(error.message);
    for(const row of data??[]){
      const id=stage(row.prov_status);
      if(!id)continue;
      cards.push({id:row.id,stage_id:id,displayName:mapName(row.prov_name_f,row.prov_name_l),
        field_values:{prov_field:row.prov_field,prov_state:row.prov_state},
        created_at:row.created_at,updated_at:row.updated_at,
        next_action:null,next_action_due_at:null,sourceUrl:'/crm/staff'});
    }
  }else if(pipeline.source_key==='clients'){
    // Direct source RLS controls access; do not leak client attributes to
    // contact tables or broaden CRM permissions to make a board appear full.
    const rows=await pages((from,to)=>supabase.from('clients')
      .select('id,pat_name_f,pat_name_l,pat_name_preferred,lifecycle_stage,pat_status,created_at,updated_at')
      .eq('tenant_id',tenantId).order('created_at').range(from,to));
    for(const row of rows){
      const id=stage(row.lifecycle_stage??'');
      if(!id)continue;
      cards.push({id:row.id,stage_id:id,
        displayName:mapName(row.pat_name_preferred||row.pat_name_f,row.pat_name_l),
        field_values:{pat_status:row.pat_status},created_at:row.created_at,updated_at:row.updated_at,
        next_action:null,next_action_due_at:null,sourceUrl:'/crm/clients/'+row.id});
    }
  }else if(pipeline.source_key==='relationship_opportunities'){
    const rows=await pages((from,to)=>supabase.from('relationship_opportunities')
      .select('id,organization_id,status,version,owner_profile_id,cause_area,veteran_priority,next_action,next_action_due_at,created_at,updated_at')
      .eq('tenant_id',tenantId).order('created_at').range(from,to));
    const subjectRecords=rows.map(r=>({
      organization_id:r.organization_id,
    })) as CrmPipelineRecord[];
    const organizations=await getPipelineCardSubjects(pipeline,subjectRecords);
    for(const row of rows){
      const id=stage(row.status);
      if(!id)continue;
      const identity=organizations[row.organization_id];
      cards.push({id:row.id,stage_id:id,displayName:identity?.label??'Organization unavailable',
        primaryContact:identity?.primaryContact??'Primary contact needs review',
        field_values:{cause_area:row.cause_area,veteran_priority:row.veteran_priority},
        created_at:row.created_at,updated_at:row.updated_at,
        next_action:row.next_action,next_action_due_at:row.next_action_due_at,
        sourceStatus:row.status,sourceVersion:row.version,owner_profile_id:row.owner_profile_id,
        sourceUrl:'/crm/business-development/opportunities/'+row.id});
    }
  }else{
    throw new Error('A source adapter has not been installed for this pipeline configuration.');
  }
  return cards;
}
