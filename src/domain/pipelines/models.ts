export type PipelineSubject = 'person' | 'organization';
export type PipelineSource = 'manual' | 'connected';
export type PipelineFieldType = 'text' | 'number' | 'date' | 'datetime' | 'boolean' | 'currency' | 'url' | 'select' | 'multiselect';
export interface CrmPipeline { id:string; tenant_id:string; name:string; subject_type:PipelineSubject; source_mode:PipelineSource; source_key:string|null; card_field_keys:string[]; sort_field_keys:string[]; archived_at:string|null; created_by:string; created_at:string; updated_at:string; }
export interface CrmPipelineStage { id:string; tenant_id:string; pipeline_id:string; name:string; position:number; is_terminal:boolean; source_stage_key:string|null; created_at:string; }
export interface CrmPipelineField { id:string; tenant_id:string; pipeline_id:string; field_key:string; label:string; field_type:PipelineFieldType; options:string[]; required:boolean; show_on_card:boolean; allow_sort:boolean; position:number; created_at:string; }
export interface CrmPipelineRecord { id:string; tenant_id:string; pipeline_id:string; stage_id:string; contact_id:string|null; organization_id:string|null; associated_organization_id:string|null; owner_profile_id:string|null; next_action:string|null; next_action_due_at:string|null; field_values:Record<string,unknown>; source_record_type:string|null; source_record_id:string|null; created_at:string; updated_at:string; version:number; }
export const mandatoryCardFields = (subject: PipelineSubject): readonly string[] => subject==='organization' ? ['organization_name','primary_contact'] : ['person_name'];
export const builtinSortFields = [{key:'updated_at',label:'Last updated'},{key:'created_at',label:'Created'},{key:'next_action_due_at',label:'Next action due'}] as const;
export function normalizePipelineFieldKey(value:string):string { return value.trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,64); }
export function availableSortFields(pipeline:CrmPipeline,fields:CrmPipelineField[]):Array<{key:string;label:string}>{ const valid=new Map<string,string>([...builtinSortFields.map(f=>[f.key,f.label] as const),...fields.filter(f=>f.allow_sort).map(f=>[f.field_key,f.label] as const)]); return [...new Set(pipeline.sort_field_keys)].filter(k=>valid.has(k)).map(key=>({key,label:valid.get(key)!})); }
export function cardFieldLabels(pipeline:CrmPipeline,fields:CrmPipelineField[]) { const enabled=new Set(pipeline.card_field_keys); return fields.filter(f=>f.show_on_card&&enabled.has(f.field_key)); }
export function comparePipelineRecords(a:CrmPipelineRecord,b:CrmPipelineRecord,sortKey:string) { const value=(r:CrmPipelineRecord) => sortKey==='created_at'||sortKey==='updated_at'||sortKey==='next_action_due_at'?r[sortKey]:r.field_values[sortKey]; const va=value(a),vb=value(b); if(va==null&&vb==null)return a.id.localeCompare(b.id); if(va==null)return 1; if(vb==null)return -1; if(typeof va==='number'&&typeof vb==='number')return va-vb; return String(va).localeCompare(String(vb),undefined,{numeric:true,sensitivity:'base'}); }
export interface CrmPipelineStageRule {
  tenant_id:string;pipeline_id:string;from_stage_id:string;to_stage_id:string;
  is_allowed:boolean;created_at:string;
}
export interface CrmPipelineSavedView {
  id:string;tenant_id:string;pipeline_id:string;owner_profile_id:string;
  name:string;view_mode:'board'|'list';sort_key:string;search_text:string;
  stage_id:string|null;attention:'all'|'overdue'|'no_next_action';
  owner_filter:'all'|'mine'|'unassigned';created_at:string;updated_at:string;
}
