import {describe,it,expect} from 'vitest';
import {mandatoryCardFields,availableSortFields,normalizePipelineFieldKey,comparePipelineRecords,type CrmPipeline,type CrmPipelineField,type CrmPipelineRecord} from './models';
const p={id:'p',tenant_id:'tenant',name:'Example',subject_type:'organization',source_mode:'manual',source_key:null,card_field_keys:['state'],sort_field_keys:['updated_at','state'],archived_at:null,created_by:'u',created_at:'',updated_at:''} as CrmPipeline;
const field={id:'f',tenant_id:'tenant',pipeline_id:'p',field_key:'state',label:'State',field_type:'text',options:[],required:false,show_on_card:true,allow_sort:true,position:1,created_at:''} as CrmPipelineField;
const record=(id:string,fieldValues:Record<string,unknown>)=>({id,updated_at:'2026-10-09',created_at:'2026-10-08',next_action_due_at:null,field_values:fieldValues} as CrmPipelineRecord);
describe('configurable CRM pipeline configuration',()=>{
  it('requires exactly one global primary on organizational cards and a person name on personal cards',()=>{
    expect(mandatoryCardFields('organization')).toEqual(['organization_name','primary_contact']);
    expect(mandatoryCardFields('person')).toEqual(['person_name']);
  });
  it('only offers fields explicitly selected for per-pipeline sorting',()=>{
    expect(availableSortFields(p,[field])).toEqual([{key:'updated_at',label:'Last updated'},{key:'state',label:'State'}]);
    expect(availableSortFields({...p,sort_field_keys:['state','unconfigured']},[{...field,allow_sort:false}])).toEqual([]);
  });
  it('uses data-defined normalized keys, not pipeline names',()=>{
    expect(normalizePipelineFieldKey('  License / State  ')).toBe('license_state');
    expect(comparePipelineRecords(record('a',{state:'AZ'}),record('b',{state:'MO'}),'state')).toBeLessThan(0);
  });
});