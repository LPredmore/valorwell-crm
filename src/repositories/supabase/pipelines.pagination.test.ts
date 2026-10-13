import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CrmPipeline, CrmPipelineRecord } from '@/domain/pipelines/models';

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from } }));
import { pipelinesRepository } from './pipelines';

const pipeline = {
  id: 'pipeline-1', tenant_id: 'tenant-1', source_mode: 'manual',
} as CrmPipeline;
const row = (id:string) => ({ id }) as CrmPipelineRecord;

function queryResult(data:CrmPipelineRecord[],error:null|{message:string}=null){
  const query = {
    select:vi.fn().mockReturnThis(), eq:vi.fn().mockReturnThis(),
    order:vi.fn().mockReturnThis(), gt:vi.fn().mockReturnThis(),
    limit:vi.fn(), then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({data,error}).then(resolve),
  };
  query.limit.mockReturnValue(query);
  from.mockReturnValue(query);
  return query;
}

describe('manual pipeline keyset pagination',()=>{
  beforeEach(()=>vi.clearAllMocks());

  it('scopes the first page to tenant and pipeline, includes lookahead and exposes an ID cursor',async()=>{
    const query=queryResult([row('a'),row('b'),row('c')]);
    const result=await pipelinesRepository.recordPage(pipeline,null,2);
    expect(from).toHaveBeenCalledWith('crm_pipeline_records');
    expect(query.eq).toHaveBeenCalledWith('tenant_id','tenant-1');
    expect(query.eq).toHaveBeenCalledWith('pipeline_id','pipeline-1');
    expect(query.order).toHaveBeenCalledWith('id',{ascending:true});
    expect(query.limit).toHaveBeenCalledWith(3);
    expect(query.gt).not.toHaveBeenCalled();
    expect(result.rows.map(r=>r.id)).toEqual(['a','b']);
    expect(result.nextCursor).toBe('b');
  });

  it('continues strictly after the cursor without replaying earlier rows',async()=>{
    const query=queryResult([row('c'),row('d')]);
    const result=await pipelinesRepository.recordPage(pipeline,'b',2);
    expect(query.gt).toHaveBeenCalledWith('id','b');
    expect(result.rows.map(r=>r.id)).toEqual(['c','d']);
    expect(result.nextCursor).toBeNull();
  });

  it('supports empty pages and rejects connected-source access',async()=>{
    queryResult([]);
    expect(await pipelinesRepository.recordPage(pipeline,'z')).toEqual({rows:[],nextCursor:null});
    await expect(pipelinesRepository.recordPage({...pipeline,source_mode:'connected'},null))
      .rejects.toThrow('authoritative source');
    expect(from).toHaveBeenCalledTimes(1);
  });

  it('bounds individual server queries to 200 rows and propagates database errors',async()=>{
    const query=queryResult([],{message:'Access denied'});
    await expect(pipelinesRepository.recordPage(pipeline,null,5000)).rejects.toThrow('Access denied');
    expect(query.limit).toHaveBeenCalledWith(201);
  });
});
