import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CrmPipeline, CrmPipelineRecord } from '@/domain/pipelines/models';

const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(),rpc:vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from,rpc } }));
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

  it('combines unassigned and no-next-action as global server predicates',async()=>{
    rpc.mockResolvedValue({data:[],error:null});
    await pipelinesRepository.recordPage(pipeline,null,200,{
      stageId:null,owner:'unassigned',attention:'no_next_action',userId:null,
    });
    expect(rpc).toHaveBeenCalledWith('crm_find_manual_pipeline_records',expect.objectContaining({
      p_owner_filter:'unassigned',p_attention:'no_next_action',p_page_size:201,
    }));
    expect(from).not.toHaveBeenCalled();
  });

  it('refuses mine filter without a signed-in identity, avoiding accidental unfiltered results',async()=>{
    queryResult([]);
    await expect(pipelinesRepository.recordPage(pipeline,null,200,{
      stageId:null,owner:'mine',attention:'all',userId:null,
    })).rejects.toThrow('Sign in');
  });
  it('runs full-dataset text search through a bounded invoker RPC with stage/tenant filters',async()=>{
    rpc.mockResolvedValue({data:[row('b'),row('c'),row('d')],error:null});
    const result=await pipelinesRepository.recordPage(pipeline,'a',2,{
      searchText:'  Veterans  ',stageId:'stage-1',owner:'mine',attention:'all',userId:'staff-1',
    });
    expect(rpc).toHaveBeenCalledWith('crm_find_manual_pipeline_records',{
      p_tenant_id:'tenant-1',p_pipeline_id:'pipeline-1',p_after_id:'a',
      p_search:'Veterans',p_stage_id:'stage-1',p_owner_filter:'mine',p_attention:'all',p_page_size:3,
    });
    expect(result).toEqual({rows:[row('b'),row('c')],nextCursor:'c'});
    expect(from).not.toHaveBeenCalled();
  });

  it('searches globally for no-next-action cards even without a search phrase',async()=>{
    rpc.mockResolvedValue({data:[row('b')],error:null});
    const result=await pipelinesRepository.recordPage(pipeline,null,200,{
      searchText:'',stageId:null,owner:'all',attention:'no_next_action',userId:'staff-1',
    });
    expect(rpc).toHaveBeenCalledWith('crm_find_manual_pipeline_records',expect.objectContaining({
      p_attention:'no_next_action',p_page_size:201,
    }));
    expect(result.nextCursor).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it('does not silently fall back to incomplete client filtering on RPC errors',async()=>{
    rpc.mockResolvedValue({data:null,error:{message:'Search function unavailable'}});
    await expect(pipelinesRepository.recordPage(pipeline,null,200,{
      searchText:'Smith',stageId:null,owner:'all',attention:'all',userId:'staff-1',
    })).rejects.toThrow('Search function unavailable');
    expect(from).not.toHaveBeenCalled();
  });

  it('bounds server search input length and the RPC lookahead to 201 rows',async()=>{
    rpc.mockResolvedValue({data:[],error:null});
    await pipelinesRepository.recordPage(pipeline,null,1000,{
      searchText:'a'.repeat(400),stageId:null,owner:'all',attention:'all',userId:'staff-1',
    });
    const args=rpc.mock.calls[0][1] as {p_page_size:number;p_search:string};
    expect(args.p_page_size).toBe(201);
    expect(args.p_search).toHaveLength(200);
  });
  it.each(['updated_at','created_at','next_action_due_at'] as const)(
    'paginates the entire manual pipeline using an authorized global %s date sort',
    async sortKey=>{
      rpc.mockResolvedValue({data:[row('a'),row('b'),row('c')],error:null});
      const result=await pipelinesRepository.recordPage(pipeline,'previous',2,{
        sortKey,stageId:'stage-1',owner:'mine',attention:'overdue',userId:'staff-1',
        searchText:'Veterans',
      });
      expect(result).toEqual({rows:[row('a'),row('b')],nextCursor:'b'});
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(rpc).toHaveBeenCalledWith('crm_find_manual_pipeline_records_sorted',{
        p_tenant_id:'tenant-1',p_pipeline_id:'pipeline-1',
        p_after_id:'previous',p_search:'Veterans',p_stage_id:'stage-1',
        p_owner_filter:'mine',p_attention:'overdue',p_page_size:3,p_sort_key:sortKey,
      });
      expect(from).not.toHaveBeenCalled();
      vi.clearAllMocks();
    },
  );

  it('does not claim a successful globally sorted page after database error',async()=>{
    rpc.mockResolvedValue({data:null,error:{message:'Sorted pipeline unavailable'}});
    await expect(pipelinesRepository.recordPage(pipeline,null,200,{
      sortKey:'updated_at',stageId:null,owner:'all',attention:'all',userId:'staff',
      searchText:'',
    })).rejects.toThrow('Sorted pipeline unavailable');
    expect(from).not.toHaveBeenCalled();
  });

  it('keeps custom-field sorting on the explicit loaded-only fallback',async()=>{
    const query=queryResult([row('a')]);
    const result=await pipelinesRepository.recordPage(pipeline,null,200,{
      sortKey:'custom_rank',stageId:null,owner:'all',attention:'all',userId:'staff',
      searchText:'',
    });
    expect(result.nextCursor).toBeNull();
    expect(query.order).toHaveBeenCalledWith('id',{ascending:true});
    expect(rpc).not.toHaveBeenCalled();
  });

});
