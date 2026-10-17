import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import type { CrmPipeline, CrmPipelineField, CrmPipelineStage, CrmPipelineRecord, CrmPipelineStageRule, CrmPipelineSavedView, PipelineSubject, PipelineFieldType } from '@/domain/pipelines/models';
import type { AttentionFilter, OwnerFilter } from '@/domain/pipelines/board-view';

export interface PipelineServerFilters {
  stageId:string|null;
  owner:OwnerFilter;
  attention:AttentionFilter;
  userId:string|null;
  searchText?:string;
  sortKey?:string;
}

type Entry<Row,Insert,Update>={Row:Row;Insert:Insert;Update:Update;Relationships:[]};
type Db={
  public:{
    Tables:{
      crm_pipelines:Entry<CrmPipeline,Partial<CrmPipeline>&Pick<CrmPipeline,'tenant_id'|'name'|'subject_type'|'created_by'>,Partial<CrmPipeline>>;
      crm_pipeline_stages:Entry<CrmPipelineStage,Partial<CrmPipelineStage>&Pick<CrmPipelineStage,'tenant_id'|'pipeline_id'|'name'|'position'>,Partial<CrmPipelineStage>>;
      crm_pipeline_fields:Entry<CrmPipelineField,Partial<CrmPipelineField>&Pick<CrmPipelineField,'tenant_id'|'pipeline_id'|'field_key'|'label'|'field_type'>,Partial<CrmPipelineField>>;
      crm_pipeline_records:Entry<CrmPipelineRecord,Partial<CrmPipelineRecord>&Pick<CrmPipelineRecord,'tenant_id'|'pipeline_id'|'stage_id'>,Partial<CrmPipelineRecord>>;
      crm_pipeline_stage_rules:Entry<CrmPipelineStageRule,Partial<CrmPipelineStageRule>&Pick<CrmPipelineStageRule,'tenant_id'|'pipeline_id'|'from_stage_id'|'to_stage_id'|'is_allowed'>,Partial<CrmPipelineStageRule>>;
      crm_pipeline_saved_views:Entry<CrmPipelineSavedView,Partial<CrmPipelineSavedView>&Pick<CrmPipelineSavedView,'tenant_id'|'pipeline_id'|'owner_profile_id'|'name'>,Partial<CrmPipelineSavedView>>;
    };
    Views:Record<string,never>;
    Functions:Record<string,never>;
    Enums:Record<string,never>;
    CompositeTypes:Record<string,never>;
  };
};
const db=supabase as unknown as SupabaseClient<Db>;
function assert(error:{message:string}|null){if(error)throw new Error(error.message);}
export const pipelinesRepository={
  async list(tenantId:string):Promise<CrmPipeline[]>{
    const {data,error}=await db.from('crm_pipelines').select('*').eq('tenant_id',tenantId)
      .is('archived_at',null).order('created_at',{ascending:true}).limit(300);
    assert(error);return (data??[]) as CrmPipeline[];
  },
  async create(tenantId:string,userId:string,name:string,subject:PipelineSubject):Promise<CrmPipeline>{
    const {data,error}=await db.from('crm_pipelines').insert({
      tenant_id:tenantId,created_by:userId,name:name.trim(),subject_type:subject,
      source_mode:'manual',card_field_keys:[],sort_field_keys:['updated_at'],
    } as never).select('*').single();
    assert(error);if(!data)throw new Error('Pipeline was not created');return data as CrmPipeline;
  },
  async update(p:CrmPipeline,patch:Partial<Pick<CrmPipeline,'name'|'card_field_keys'|'sort_field_keys'|'archived_at'>>){
    const {error}=await db.from('crm_pipelines').update(patch as never).eq('tenant_id',p.tenant_id).eq('id',p.id);
    assert(error);
  },
  async stages(p:CrmPipeline):Promise<CrmPipelineStage[]>{
    const {data,error}=await db.from('crm_pipeline_stages').select('*').eq('tenant_id',p.tenant_id).eq('pipeline_id',p.id).order('position');
    assert(error);return (data??[]) as CrmPipelineStage[];
  },
  async addStage(p:CrmPipeline,name:string,position:number){
    const {error}=await db.from('crm_pipeline_stages').insert({tenant_id:p.tenant_id,pipeline_id:p.id,name:name.trim(),position} as never);assert(error);
  },
  async fields(p:CrmPipeline):Promise<CrmPipelineField[]>{
    const {data,error}=await db.from('crm_pipeline_fields').select('*').eq('tenant_id',p.tenant_id).eq('pipeline_id',p.id).order('position');
    assert(error);return (data??[]) as CrmPipelineField[];
  },
  async addField(p:CrmPipeline,input:{label:string;fieldKey:string;type:PipelineFieldType;options:string[];position:number}){
    const {error}=await db.from('crm_pipeline_fields').insert({
      tenant_id:p.tenant_id,pipeline_id:p.id,label:input.label.trim(),field_key:input.fieldKey,
      field_type:input.type,options:input.options,position:input.position,
      show_on_card:false,allow_sort:false,required:false,
    } as never);assert(error);
  },
  async updateField(f:CrmPipelineField,patch:Partial<Pick<CrmPipelineField,'show_on_card'|'allow_sort'|'required'|'label'>>){
    const {error}=await db.from('crm_pipeline_fields').update(patch as never).eq('tenant_id',f.tenant_id).eq('id',f.id);
    assert(error);
  },
  async recordPage(p:CrmPipeline,cursor:string|null,pageSize=200,filters?:PipelineServerFilters):Promise<{rows:CrmPipelineRecord[];nextCursor:string|null}>{
    if(p.source_mode!=='manual')throw new Error('Connected pipelines use their authoritative source adapters.');
    const size=Math.max(1,Math.min(200,Math.floor(pageSize)));
    // Builtin date sorts are global, with (timestamp, id) keyset ordering.
    // Do not fall back to local sorting after an RPC error: that could silently
    // omit matching records from earlier/later pages.
    if(filters?.sortKey==='updated_at'||filters?.sortKey==='created_at'||filters?.sortKey==='next_action_due_at'){
      const {data,error}=await supabase.rpc('crm_find_manual_pipeline_records_sorted' as never,{
        p_tenant_id:p.tenant_id,p_pipeline_id:p.id,p_after_id:cursor,
        p_search:filters.searchText?.trim().slice(0,200)??'',
        p_stage_id:filters.stageId,p_owner_filter:filters.owner,
        p_attention:filters.attention,p_page_size:size+1,p_sort_key:filters.sortKey,
      } as never);
      assert(error);
      const page=(data??[]) as CrmPipelineRecord[];
      const rows=page.slice(0,size);
      return {rows,nextCursor:page.length>size?rows[rows.length-1].id:null};
    }
    // Full-dataset name/primary-contact/custom-field search and whitespace-aware
    // missing-action predicates require the RLS-respecting invoker SQL RPC.
    // Pass only the authenticated session's user identity to other code paths;
    // the RPC itself obtains auth.uid() rather than trusting an owner UUID.
    if(filters?.searchText?.trim()||filters?.attention==='no_next_action'){
      const {data,error}=await supabase.rpc('crm_find_manual_pipeline_records' as never,{
        p_tenant_id:p.tenant_id,p_pipeline_id:p.id,p_after_id:cursor,
        p_search:filters.searchText?.trim().slice(0,200)??'',
        p_stage_id:filters.stageId,p_owner_filter:filters.owner,
        p_attention:filters.attention,p_page_size:size+1,
      } as never);
      assert(error);
      const page=(data??[]) as CrmPipelineRecord[];
      const rows=page.slice(0,size);
      return {rows,nextCursor:page.length>size?rows[rows.length-1].id:null};
    }
    // (tenant_id,pipeline_id,id) is an existing unique B-tree index. ID
    // keyset paging avoids OFFSET rescans and does not impose a 2,000-row cap.
    // The extra row proves that another page exists without a count query.
    let query=db.from('crm_pipeline_records').select('*')
      .eq('tenant_id',p.tenant_id).eq('pipeline_id',p.id)
      .order('id',{ascending:true}).limit(size+1);
    if(filters?.stageId)query=query.eq('stage_id',filters.stageId);
    if(filters?.owner==='mine'){
      if(!filters.userId)throw new Error('Sign in to filter records assigned to you.');
      query=query.eq('owner_profile_id',filters.userId);
    }else if(filters?.owner==='unassigned')query=query.is('owner_profile_id',null);
    if(filters?.attention==='overdue')query=query.lt('next_action_due_at',new Date().toISOString());
    if(cursor)query=query.gt('id',cursor);
    const {data,error}=await query;
    assert(error);
    const rows=((data??[]) as CrmPipelineRecord[]).slice(0,size);
    return {rows,nextCursor:(data?.length??0)>size?rows[rows.length-1].id:null};
  },
  /** Exact record lookup for bookmarks; independent of the currently loaded board page. */
  async getRecord(p:CrmPipeline,id:string):Promise<CrmPipelineRecord|null>{
    if(p.source_mode!=='manual')throw new Error('Use the source workflow for connected records.');
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
      throw new Error('Invalid pipeline record link.');
    const {data,error}=await db.from('crm_pipeline_records').select('*')
      .eq('tenant_id',p.tenant_id).eq('pipeline_id',p.id).eq('id',id).maybeSingle();
    assert(error);return data as CrmPipelineRecord|null;
  },
  /** Relationship-only memberships. No connected clinical adapters are invoked. */
  async subjectRecordsPage(tenantId:string,subject:{contactId:string;organizationId?:never}|{organizationId:string;contactId?:never},page=1){
    const id=subject.contactId??subject.organizationId;
    if(!id||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
      throw new Error('Invalid relationship record.');
    if(!Number.isSafeInteger(page)||page<1)throw new Error('Invalid pipeline membership page.');
    let query=db.from('crm_pipeline_records')
      .select('id,pipeline_id,stage_id,owner_profile_id,next_action,next_action_due_at,updated_at,organization_id,associated_organization_id',{count:'exact'})
      .eq('tenant_id',tenantId).is('source_record_id',null);
    query=subject.contactId?query.eq('contact_id',id)
      :query.or(`organization_id.eq.${id},associated_organization_id.eq.${id}`);
    const offset=(page-1)*25;
    const {data,error,count}=await query.order('updated_at',{ascending:false})
      .order('id',{ascending:true}).range(offset,offset+24);
    assert(error);
    type MembershipRow=Pick<CrmPipelineRecord,'id'|'pipeline_id'|'stage_id'|'owner_profile_id'|'next_action'|'next_action_due_at'|'updated_at'|'organization_id'|'associated_organization_id'>;
    const rows=(data??[]) as MembershipRow[];
    const ids=[...new Set(rows.map(row=>row.pipeline_id))];
    if(!ids.length)return {items:[],total:count??0,page,pageSize:25};
    const [pipelines,stages]=await Promise.all([
      db.from('crm_pipelines').select('id,name,source_mode,archived_at').eq('tenant_id',tenantId).in('id',ids),
      db.from('crm_pipeline_stages').select('id,pipeline_id,name').eq('tenant_id',tenantId).in('pipeline_id',ids),
    ]);
    assert(pipelines.error);assert(stages.error);
    // Selected column shapes are explicit: PostgREST's inferred partial-row type
    // is `never` for this locally defined CRM schema, despite valid columns.
    const pipelineRows=(pipelines.data??[]) as Pick<CrmPipeline,'id'|'name'|'source_mode'|'archived_at'>[];
    const stageRows=(stages.data??[]) as Pick<CrmPipelineStage,'id'|'pipeline_id'|'name'>[];
    return {items:rows.map(row=>({
      ...row,pipeline:pipelineRows.find(item=>item.id===row.pipeline_id)??null,
      stageName:stageRows.find(item=>item.id===row.stage_id&&item.pipeline_id===row.pipeline_id)?.name??null,
      association:subject.organizationId&&row.associated_organization_id===id?'Related organization':'Subject',
    })),total:count??0,page,pageSize:25};
  },
  async enroll(p:CrmPipeline,stageId:string,subjectId:string,associatedOrganizationId?:string|null){
    if(p.source_mode!=='manual')throw new Error('Connected pipelines must be synchronized from their authoritative source.');
    const {error}=await db.from('crm_pipeline_records').insert({
      tenant_id:p.tenant_id,pipeline_id:p.id,stage_id:stageId,
      contact_id:p.subject_type==='person'?subjectId:null,
      organization_id:p.subject_type==='organization'?subjectId:null,
      associated_organization_id:p.subject_type==='person'?(associatedOrganizationId??null):null,
      field_values:{},
    } as never);assert(error);
  },
  async move(record:CrmPipelineRecord,stageId:string){
    if(record.source_record_id)throw new Error('Connected source stages cannot be manually overwritten.');
    const {data,error}=await supabase.rpc('crm_move_manual_pipeline_record' as never,{
      p_record_id:record.id,p_expected_version:record.version,p_to_stage_id:stageId,
    } as never);
    assert(error);
    if(data===null)throw new Error('Move failed. Refresh the board and retry.');
    return data as number;
  },
  async bulkMove(records:CrmPipelineRecord[],stageId:string):Promise<number>{
    if(records.length<1||records.length>20)throw new Error('Select between 1 and 20 pipeline records.');
    const [first]=records;
    if(records.some(row=>row.tenant_id!==first.tenant_id||row.pipeline_id!==first.pipeline_id))
      throw new Error('Bulk moves must stay inside one tenant and one pipeline.');
    if(records.some(row=>row.source_record_id||row.source_record_type))
      throw new Error('Source-connected records cannot be moved through the generic CRM bulk action.');
    if(new Set(records.map(row=>row.id)).size!==records.length)
      throw new Error('Duplicate records are not allowed in a bulk move.');
    const {data,error}=await supabase.rpc('crm_bulk_move_manual_pipeline_records' as never,{
      p_items:records.map(row=>({id:row.id,version:row.version})),
      p_to_stage_id:stageId,
    } as never);
    assert(error);
    if(data!==records.length)throw new Error('Could not verify the completed bulk operation. Refresh before retrying.');
    return data as number;
  },
  async updateValues(record:CrmPipelineRecord,values:Record<string,unknown>){
    const {data,error}=await db.from('crm_pipeline_records').update({field_values:values} as never)
      .eq('tenant_id',record.tenant_id).eq('id',record.id).eq('version',record.version).select('id').maybeSingle();
    assert(error);if(!data)throw new Error('The record changed since you opened it. Refresh and retry.');
  },
  async stageRules(p:CrmPipeline):Promise<CrmPipelineStageRule[]>{
    const {data,error}=await db.from('crm_pipeline_stage_rules').select('*').eq('tenant_id',p.tenant_id).eq('pipeline_id',p.id);
    assert(error);return (data??[]) as CrmPipelineStageRule[];
  },
  async setStageRule(p:CrmPipeline,fromId:string,toId:string,isAllowed:boolean){
    if(p.source_mode!=='manual')throw new Error('Source-connected pipeline transition rules belong to the source workflow.');
    const {error}=await db.from('crm_pipeline_stage_rules').upsert({
      tenant_id:p.tenant_id,pipeline_id:p.id,from_stage_id:fromId,to_stage_id:toId,is_allowed:isAllowed,
    } as never,{onConflict:'pipeline_id,from_stage_id,to_stage_id'});assert(error);
  },
  async removeStageRule(rule:CrmPipelineStageRule){
    const {error}=await db.from('crm_pipeline_stage_rules').delete()
      .eq('tenant_id',rule.tenant_id).eq('pipeline_id',rule.pipeline_id)
      .eq('from_stage_id',rule.from_stage_id).eq('to_stage_id',rule.to_stage_id);
    assert(error);
  },
  async savedViews(p:CrmPipeline,userId:string):Promise<CrmPipelineSavedView[]>{
    const {data,error}=await db.from('crm_pipeline_saved_views').select('*')
      .eq('tenant_id',p.tenant_id).eq('pipeline_id',p.id)
      .eq('owner_profile_id',userId).order('name').limit(100);
    assert(error);return (data??[]) as CrmPipelineSavedView[];
  },
  async saveView(p:CrmPipeline,userId:string,view:Pick<CrmPipelineSavedView,'name'|'view_mode'|'sort_key'|'search_text'|'stage_id'|'attention'|'owner_filter'>){
    const {error}=await db.from('crm_pipeline_saved_views').insert({
      ...view,tenant_id:p.tenant_id,pipeline_id:p.id,owner_profile_id:userId,
    } as never);assert(error);
  },
  async updateWorkflow(record:CrmPipelineRecord,patch:Pick<CrmPipelineRecord,'owner_profile_id'|'next_action'|'next_action_due_at'>){
    if(record.source_record_id)throw new Error('Connected source workflows must be edited in their authoritative system.');
    const {data,error}=await db.from('crm_pipeline_records')
      .update(patch as never).eq('tenant_id',record.tenant_id).eq('pipeline_id',record.pipeline_id)
      .eq('id',record.id).eq('version',record.version).select('id').maybeSingle();
    assert(error);if(!data)throw new Error('This record changed. Refresh and retry.');
  },
  async updateSavedView(view:CrmPipelineSavedView,patch:Pick<CrmPipelineSavedView,'view_mode'|'sort_key'|'search_text'|'stage_id'|'attention'|'owner_filter'>){
    const {data,error}=await db.from('crm_pipeline_saved_views').update(patch as never)
      .eq('tenant_id',view.tenant_id).eq('pipeline_id',view.pipeline_id)
      .eq('id',view.id).eq('owner_profile_id',view.owner_profile_id).select('id').maybeSingle();
    assert(error);if(!data)throw new Error('Saved view could not be updated with your permissions.');
  },
  async deleteView(view:CrmPipelineSavedView){
    const {error}=await db.from('crm_pipeline_saved_views').delete().eq('id',view.id)
      .eq('tenant_id',view.tenant_id).eq('pipeline_id',view.pipeline_id)
      .eq('owner_profile_id',view.owner_profile_id);
    assert(error);
  },
};
