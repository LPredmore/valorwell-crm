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
    is:vi.fn().mockReturnThis(), lt:vi.fn().mockReturnThis(),
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
  it('applies tenant-scoped stage, owner and overdue filters BEFORE cursor pagination',async()=>{
    const query=queryResult([row('x')]);
    await pipelinesRepository.recordPage(pipeline,'a',25,{
      stageId:'stage-2',owner:'mine',attention:'overdue',userId:'staff-2',
    });
    expect(query.eq).toHaveBeenCalledWith('tenant_id','tenant-1');
    expect(query.eq).toHaveBeenCalledWith('pipeline_id','pipeline-1');
    expect(query.eq).toHaveBeenCalledWith('stage_id','stage-2');
    expect(query.eq).toHaveBeenCalledWith('owner_profile_id','staff-2');
    expect(query.lt).toHaveBeenCalledWith('next_action_due_at',expect.any(String));
    expect(query.gt).toHaveBeenCalledWith('id','a');
    expect(query.limit).toHaveBeenCalledWith(26);
  });

  it('restricts unassigned globally but leaves no-next-action for loaded-card filtering',async()=>{
    const query=queryResult([]);
    await pipelinesRepository.recordPage(pipeline,null,200,{
      stageId:null,owner:'unassigned',attention:'no_next_action',userId:null,
    });
    expect(query.is).toHaveBeenCalledWith('owner_profile_id',null);
    expect(query.lt).not.toHaveBeenCalled();
    expect(query.eq).not.toHaveBeenCalledWith('owner_profile_id',expect.anything());
  });

  it('refuses mine filter without a signed-in identity, avoiding accidental unfiltered results',async()=>{
    queryResult([]);
    await expect(pipelinesRepository.recordPage(pipeline,null,200,{
      stageId:null,owner:'mine',attention:'all',userId:null,
    })).rejects.toThrow('Sign in');
  });
});
