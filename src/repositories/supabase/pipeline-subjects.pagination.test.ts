import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CrmPipeline, CrmPipelineRecord } from '@/domain/pipelines/models';

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from } }));
import { getPipelineCardSubjects } from './pipeline-subjects';

const makePipeline = (subject_type:'person'|'organization') => ({
  tenant_id:'tenant-1',subject_type,
}) as CrmPipeline;
const contactRecord = (id:string) => ({ id,contact_id:id }) as CrmPipelineRecord;
const orgRecord = (id:string) => ({ id,organization_id:id }) as CrmPipelineRecord;

const requests:Array<{table:string;field:string;ids:string[];tenant:boolean}>=[];
beforeEach(()=>{
  vi.clearAllMocks();
  requests.length=0;
  from.mockImplementation((table:string)=>{
    const filters:Array<[string,unknown]> = [];
    const query={
      select:vi.fn().mockReturnThis(),
      eq:vi.fn((key:string,value:unknown)=>{filters.push([key,value]);return query;}),
      in:vi.fn((field:string,ids:string[])=>{
        requests.push({table,field,ids,tenant:filters.some(([key,value])=>key==='tenant_id'&&value==='tenant-1')});
        let data:Record<string,unknown>[]=[];
        if(table==='relationship_contacts')data=ids.map(id=>({id,first_name:'First',last_name:id}));
        if(table==='relationship_organizations')data=ids.map(id=>({id,name:'Organization '+id}));
        if(table==='relationship_contact_organizations')data=ids.map(id=>({
          organization_id:id,contact_id:id.replace('org-', 'person-'),
        }));
        return Promise.resolve({data,error:null});
      }),
    };
    return query;
  });
});

describe('tenant-scoped pipeline identity hydration',()=>{
  it('retrieves over 300 unique people without a single oversized IN query',async()=>{
    const records=Array.from({length:351},(_,i)=>contactRecord('person-'+i));
    const result=await getPipelineCardSubjects(makePipeline('person'),records);
    expect(Object.keys(result)).toHaveLength(351);
    expect(result['person-350'].label).toBe('First person-350');
    expect(requests.map(r=>r.ids.length)).toEqual([150,150,51]);
    expect(requests.every(r=>r.tenant)).toBe(true);
    expect(requests.every(r=>r.table==='relationship_contacts')).toBe(true);
  });

  it('hydrates organizations with exactly their global primary contact across batches',async()=>{
    const records=Array.from({length:201},(_,i)=>orgRecord('org-'+i));
    const result=await getPipelineCardSubjects(makePipeline('organization'),records);
    expect(Object.keys(result)).toHaveLength(201);
    expect(result['org-200'].label).toBe('Organization org-200');
    expect(result['org-200'].primaryContact).toBe('First person-200');
    expect(requests.map(r=>r.ids.length)).toEqual([150,51,150,51,150,51]);
    expect(requests.every(r=>r.tenant)).toBe(true);
    expect(requests.every(r=>r.ids.length<=150)).toBe(true);
    expect(requests.filter(r=>r.table==='relationship_contact_organizations').every(r=>r.field==='organization_id')).toBe(true);
  });
});
