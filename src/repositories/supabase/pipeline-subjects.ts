import { supabase } from '@/integrations/supabase/client';
import type { CrmPipeline, CrmPipelineRecord } from '@/domain/pipelines/models';

export type SubjectOption = { id:string; label:string; primaryContact?:string };
const nameOf=(row:{first_name:string|null;last_name:string|null})=>
  [row.first_name,row.last_name].filter(Boolean).join(' ').trim() || 'Unnamed contact';

/** This discovery reads CRM relationship records only; never clinical clients. */
export async function listPipelineSubjects(p:CrmPipeline,search:string):Promise<SubjectOption[]>{
  if(p.subject_type==='person'){
    let q=supabase.from('relationship_contacts').select('id,first_name,last_name').eq('tenant_id',p.tenant_id);
    if(search.trim()) q=q.or('first_name.ilike.%'+search.trim().replace(/[%,()]/g,'')+'%,last_name.ilike.%'+search.trim().replace(/[%,()]/g,'')+'%');
    const {data,error}=await q.order('updated_at',{ascending:false}).limit(80);
    if(error)throw new Error(error.message);
    return (data??[]).map(c=>({id:c.id,label:nameOf(c)}));
  }
  let q=supabase.from('relationship_organizations').select('id,name').eq('tenant_id',p.tenant_id);
  if(search.trim())q=q.ilike('name','%'+search.trim().replace(/[%_]/g,'')+'%');
  const {data,error}=await q.order('updated_at',{ascending:false}).limit(80);
  if(error)throw new Error(error.message);
  return (data??[]).map(o=>({id:o.id,label:o.name}));
}

/** All organization pipeline cards display exactly the global primary. No
 * per-pipeline contact override or fallback to a BTY episode guest. */
export async function getPipelineCardSubjects(p:CrmPipeline,records:CrmPipelineRecord[]):Promise<Record<string,SubjectOption>>{
  const ids=[...new Set(records.map(r=>p.subject_type==='person'?r.contact_id:r.organization_id).filter((x):x is string=>!!x))];
  if(!ids.length)return {};
  if(p.subject_type==='person'){
    const {data,error}=await supabase.from('relationship_contacts').select('id,first_name,last_name')
      .eq('tenant_id',p.tenant_id).in('id',ids);
    if(error)throw new Error(error.message);
    return Object.fromEntries((data??[]).map(c=>[c.id,{id:c.id,label:nameOf(c)}]));
  }
  const [orgs,affiliations]=await Promise.all([
    supabase.from('relationship_organizations').select('id,name').eq('tenant_id',p.tenant_id).in('id',ids),
    supabase.from('relationship_contact_organizations').select('organization_id,contact_id')
      .eq('tenant_id',p.tenant_id).in('organization_id',ids).eq('is_primary',true),
  ]);
  if(orgs.error)throw new Error(orgs.error.message);
  if(affiliations.error)throw new Error(affiliations.error.message);
  const contactIds=[...new Set((affiliations.data??[]).map(a=>a.contact_id))];
  const contacts=contactIds.length?await supabase.from('relationship_contacts').select('id,first_name,last_name')
    .eq('tenant_id',p.tenant_id).in('id',contactIds):{data:[],error:null};
  if(contacts.error)throw new Error(contacts.error.message);
  const people=new Map((contacts.data??[]).map(c=>[c.id,nameOf(c)]));
  const byOrg=new Map<string,string[]>();
  for(const link of affiliations.data??[])byOrg.set(link.organization_id,[...(byOrg.get(link.organization_id)??[]),people.get(link.contact_id)??'Unavailable contact']);
  return Object.fromEntries((orgs.data??[]).map(org=>{
    const names=byOrg.get(org.id)??[];
    return [org.id,{id:org.id,label:org.name,primaryContact:names.length===1?names[0]:'Primary contact needs review'}];
  }));
}

/** Optional related organization for Personal pipeline records, not a new
 * per-pipeline primary contact. */
export async function listAssociatedOrganizations(tenantId:string):Promise<Array<{id:string;name:string}>>{
  const {data,error}=await supabase.from('relationship_organizations')
    .select('id,name').eq('tenant_id',tenantId).order('name').limit(500);
  if(error)throw new Error(error.message);
  return data??[];
}
