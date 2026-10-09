import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import type { CrmPipeline, CrmPipelineField, CrmPipelineStage, CrmPipelineRecord, PipelineSubject, PipelineFieldType } from '@/domain/pipelines/models';

type Entry<Row,Insert,Update>={Row:Row;Insert:Insert;Update:Update;Relationships:[]};
type Db={
  public:{
    Tables:{
      crm_pipelines:Entry<CrmPipeline,Partial<CrmPipeline>&Pick<CrmPipeline,'tenant_id'|'name'|'subject_type'|'created_by'>,Partial<CrmPipeline>>;
      crm_pipeline_stages:Entry<CrmPipelineStage,Partial<CrmPipelineStage>&Pick<CrmPipelineStage,'tenant_id'|'pipeline_id'|'name'|'position'>,Partial<CrmPipelineStage>>;
      crm_pipeline_fields:Entry<CrmPipelineField,Partial<CrmPipelineField>&Pick<CrmPipelineField,'tenant_id'|'pipeline_id'|'field_key'|'label'|'field_type'>,Partial<CrmPipelineField>>;
      crm_pipeline_records:Entry<CrmPipelineRecord,Partial<CrmPipelineRecord>&Pick<CrmPipelineRecord,'tenant_id'|'pipeline_id'|'stage_id'>,Partial<CrmPipelineRecord>>;
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
  async records(p:CrmPipeline):Promise<CrmPipelineRecord[]>{
    const {data,error}=await db.from('crm_pipeline_records').select('*').eq('tenant_id',p.tenant_id)
      .eq('pipeline_id',p.id).order('updated_at',{ascending:false}).limit(500);
    assert(error);return (data??[]) as CrmPipelineRecord[];
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
    const {error}=await db.from('crm_pipeline_records').update({stage_id:stageId} as never).eq('tenant_id',record.tenant_id)
      .eq('id',record.id).eq('version',record.version);
    assert(error);
  },
  async updateValues(record:CrmPipelineRecord,values:Record<string,unknown>){
    const {error}=await db.from('crm_pipeline_records').update({field_values:values} as never)
      .eq('tenant_id',record.tenant_id).eq('id',record.id).eq('version',record.version);
    assert(error);
  },
};
