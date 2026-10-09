import { supabase } from '@/integrations/supabase/client';
import type { CrmPipeline } from '@/domain/pipelines/models';
import { donorCardValues,type DonorRecord,type DonorCardValues } from '@/domain/pipelines/donor-enrichment';

export type PipelineSourceKind='institutional_recruiting'|'va_facilities'|'donor_giving';
export interface ResearchCandidate{
  id:string;name:string;state:string;sourceContact:string;sourceEmail:string;
  sourceRole:string;detail:string;linkedOrganizationId:string|null;website?:string|null;
}
export async function getPipelineSourceKind(p:CrmPipeline):Promise<PipelineSourceKind|null>{
  const {data,error}=await supabase.from('crm_pipeline_source_bindings' as never)
    .select('source_kind').eq('tenant_id',p.tenant_id).eq('pipeline_id',p.id).maybeSingle();
  if(error)throw new Error(error.message);
  return (data as {source_kind:PipelineSourceKind}|null)?.source_kind??null;
}
export async function listPipelineResearch(p:CrmPipeline,kind:PipelineSourceKind):Promise<ResearchCandidate[]>{
  if(p.subject_type!=='organization'||kind==='donor_giving')return [];
  if(kind==='institutional_recruiting'){
    const {data,error}=await supabase.from('relationship_institutional_recruiting_targets')
      .select('id,organization_name,state_code,contact_name,contact_email,contact_title,specific_office,relationship_organization_id,website')
      .eq('tenant_id',p.tenant_id).order('organization_name').limit(250);
    if(error)throw new Error(error.message);
    return (data??[]).map(x=>({id:x.id,name:x.organization_name,state:x.state_code,
      sourceContact:x.contact_name??'',sourceEmail:x.contact_email??'',
      sourceRole:x.contact_title??'',detail:x.specific_office??'',
      linkedOrganizationId:x.relationship_organization_id,website:x.website}));
  }
  const {data,error}=await supabase.from('crm_va_vaccn_referral_contacts')
    .select('id,facility_name,station_number,state,visn,contact_name,email,contact_role,department,relationship_organization_id')
    .eq('tenant_id',p.tenant_id).order('facility_name').limit(250);
  if(error)throw new Error(error.message);
  type VaSourceRow={id:string;facility_name:string;state:string|null;contact_name:string|null;email:string|null;contact_role:string|null;station_number:string|null;visn:number|null;department:string|null;relationship_organization_id:string|null};
  const rows=(data??[]) as unknown as VaSourceRow[];
  return rows.map(x=>({id:x.id,name:x.facility_name,state:x.state??'',
    sourceContact:x.contact_name??'',sourceEmail:x.email??'',
    sourceRole:x.contact_role??'',detail:`Station ${x.station_number??'?'} · VISN ${x.visn??'?'} · ${x.department??''}`,
    linkedOrganizationId:x.relationship_organization_id}));
}

/** The database performs this link and the first-stage record insertion
 * atomically, checks source tenant and verifies one global primary contact. */
export async function enrollResearchCandidate(p:CrmPipeline,sourceId:string,organizationId:string){
  const {data,error}=await supabase.rpc('crm_enroll_research_source' as never,{
    p_pipeline_id:p.id,p_source_id:sourceId,p_organization_id:organizationId,
  } as never);
  if(error)throw new Error(error.message);
  return data as string;
}

export async function donorValuesByContact(p:CrmPipeline,contactIds:string[]):Promise<Record<string,DonorCardValues>>{
  if(!contactIds.length)return {};
  const {data,error}=await supabase.from('crm_donors')
    .select('relationship_contact_id,recurring_status,donation_count,lifetime_amount,last_donation_at,metadata')
    .eq('tenant_id',p.tenant_id).in('relationship_contact_id',contactIds);
  if(error)throw new Error(error.message);
  const result:Record<string,DonorCardValues>={};
  for(const row of data??[]){
    const data=donorCardValues(row as DonorRecord);
    if(row.relationship_contact_id&&data)result[row.relationship_contact_id]=data;
  }
  return result;
}

export async function createSourceOrganization(p:CrmPipeline,sourceId:string,personName:string,email:string,confirmedRegional=false){
  const {data,error}=await supabase.rpc('crm_create_research_organization' as never,{
    p_pipeline_id:p.id,p_source_id:sourceId,p_primary_name:personName.trim(),p_primary_email:email.trim(),
    p_confirm_regional_facility:confirmedRegional,
  } as never);
  if(error)throw new Error(error.message);
  return data as string;
}
