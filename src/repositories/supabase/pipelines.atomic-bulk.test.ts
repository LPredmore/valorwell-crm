import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {CrmPipelineRecord} from '@/domain/pipelines/models';
const {rpc}=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc}}));
import {pipelinesRepository} from './pipelines';

const row=(id:string,version=1):CrmPipelineRecord=>({
  id,version,tenant_id:'tenant-a',pipeline_id:'pipeline-a',
  source_record_id:null,source_record_type:null,
} as CrmPipelineRecord);

describe('atomic pipeline bulk moves',()=>{
  beforeEach(()=>vi.clearAllMocks());

  it('submits up to 20 versioned manual record IDs in one RPC, not sequential requests',async()=>{
    rpc.mockResolvedValue({data:2,error:null});
    const count=await pipelinesRepository.bulkMove([row('a',2),row('b',3)],'stage-destination');
    expect(count).toBe(2);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('crm_bulk_move_manual_pipeline_records',{
      p_items:[{id:'a',version:2},{id:'b',version:3}],
      p_to_stage_id:'stage-destination',
    });
  });

  it('rejects empty, oversized, duplicate, mixed-tenant and mixed-pipeline batches before RPC',async()=>{
    await expect(pipelinesRepository.bulkMove([],'stage')).rejects.toThrow('1 and 20');
    await expect(pipelinesRepository.bulkMove(Array.from({length:21},(_,i)=>row(String(i))),'stage')).rejects.toThrow('1 and 20');
    await expect(pipelinesRepository.bulkMove([row('a'),row('a')],'stage')).rejects.toThrow('Duplicate');
    await expect(pipelinesRepository.bulkMove([row('a'),{...row('b'),tenant_id:'tenant-b'}],'stage')).rejects.toThrow('one tenant');
    await expect(pipelinesRepository.bulkMove([row('a'),{...row('b'),pipeline_id:'pipeline-b'}],'stage')).rejects.toThrow('one tenant');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('keeps connected-source records out of generic bulk moves',async()=>{
    await expect(pipelinesRepository.bulkMove([row('a'),{...row('b'),source_record_id:'source-id'}],'stage'))
      .rejects.toThrow('Source-connected');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('propagates version-conflict errors instead of retrying individual records',async()=>{
    rpc.mockResolvedValue({data:null,error:{message:'PIPELINE_RECORD_VERSION_CONFLICT'}});
    await expect(pipelinesRepository.bulkMove([row('a'),row('b')],'stage'))
      .rejects.toThrow('PIPELINE_RECORD_VERSION_CONFLICT');
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('refuses to report success when returned count is unexpected',async()=>{
    rpc.mockResolvedValue({data:1,error:null});
    await expect(pipelinesRepository.bulkMove([row('a'),row('b')],'stage'))
      .rejects.toThrow('Could not verify');
  });
});
