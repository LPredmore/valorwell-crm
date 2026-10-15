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
export interface ResearchPageOptions { page?:number; pageSize?:number; search?:string; view?:'unlinked'|'linked'|'all' }
export async function listPipelineResearch(p:CrmPipeline,kind:PipelineSourceKind):Promise<ResearchCandidate[]>{
  return (await listPipelineResearchPage(p,kind,{pageSize:250,view:'all'})).items;
}
export async function listPipelineResearchSummary(p:CrmPipeline,kind:Exclude<PipelineSourceKind,'donor_giving'>){
  const table=kind==='institutional_recruiting'?'relationship_institutional_recruiting_targets':'crm_va_vaccn_referral_contacts';
  const [total,linked]=await Promise.all([
    supabase.from(table).select('id',{count:'exact',head:true}).eq('tenant_id',p.tenant_id),
    supabase.from(table).select('id',{count:'exact',head:true}).eq('tenant_id',p.tenant_id).not('relationship_organization_id','is',null),
  ]);
  if(total.error)throw new Error(total.error.message);
  if(linked.error)throw new Error(linked.error.message);
  return {total:total.count??0,linked:linked.count??0};
}
export async function listPipelineResearchPage(p:CrmPipeline,kind:PipelineSourceKind,options:ResearchPageOptions={}){
  const page=options.page??1,pageSize=options.pageSize??25;
  if(!Number.isSafeInteger(page)||page<1||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>250)
    throw new Error('Invalid research page.');
  const empty={items:[] as ResearchCandidate[],total:0,page,pageSize};
  if(p.subject_type!=='organization'||kind==='donor_giving')return empty;
  const from=(page-1)*pageSize;
  // A restricted literal search cannot add PostgREST filter syntax or wildcards.
  const search=(options.search??'').slice(0,200).replace(/[^\p{L}\p{N}\s@.+-]/gu,' ').trim();
  if(kind==='institutional_recruiting'){
    let query=supabase.from('relationship_institutional_recruiting_targets')
      .select('id,organization_name,state_code,contact_name,contact_email,contact_title,specific_office,relationship_organization_id,website',{count:'exact'})
      .eq('tenant_id',p.tenant_id);
    if(options.view==='unlinked')query=query.is('relationship_organization_id',null);
    if(options.view==='linked')query=query.not('relationship_organization_id','is',null);
    if(search)query=query.or(['organization_name','state_code','contact_name','contact_email']
      .map(column=>`${column}.ilike.%${search}%`).join(','));
    const {data,error,count}=await query.order('organization_name').order('id').range(from,from+pageSize-1);
    if(error)throw new Error(error.message);
    const items:ResearchCandidate[]=(data??[]).map(x=>({id:x.id,name:x.organization_name,state:x.state_code,
      sourceContact:x.contact_name??'',sourceEmail:x.contact_email??'',
      sourceRole:x.contact_title??'',detail:x.specific_office??'',
      linkedOrganizationId:x.relationship_organization_id,website:x.website}));
    return {items,total:count??0,page,pageSize};
  }
  let query=supabase.from('crm_va_vaccn_referral_contacts')
    .select('id,facility_name,station_number,state,visn,contact_name,email,contact_role,department,relationship_organization_id',{count:'exact'})
    .eq('tenant_id',p.tenant_id);
  if(options.view==='unlinked')query=query.is('relationship_organization_id',null);
  if(options.view==='linked')query=query.not('relationship_organization_id','is',null);
  if(search)query=query.or(['facility_name','state','contact_name','email','station_number']
    .map(column=>`${column}.ilike.%${search}%`).join(','));
  const {data,error,count}=await query.order('facility_name').order('id').range(from,from+pageSize-1);
  if(error)throw new Error(error.message);
  type VaSourceRow={id:string;facility_name:string;state:string|null;contact_name:string|null;email:string|null;contact_role:string|null;station_number:string|null;visn:number|null;department:string|null;relationship_organization_id:string|null};
  const rows=(data??[]) as unknown as VaSourceRow[];
  const items:ResearchCandidate[]=rows.map(x=>({id:x.id,name:x.facility_name,state:x.state??'',
    sourceContact:x.contact_name??'',sourceEmail:x.email??'',
    sourceRole:x.contact_role??'',detail:`Station ${x.station_number??'?'} · VISN ${x.visn??'?'} · ${x.department??''}`,
    linkedOrganizationId:x.relationship_organization_id}));
  return {items,total:count??0,page,pageSize};
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
