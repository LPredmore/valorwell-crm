import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CrmPipeline } from '@/domain/pipelines/models';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc } }));
import { getManualPipelineMetrics, pipelineMetricsTotals } from './pipeline-metrics';

const pipeline = { id: 'pipeline-a', tenant_id: 'tenant-a', source_mode: 'manual' } as CrmPipeline;
beforeEach(() => vi.clearAllMocks());

describe('authoritative manual pipeline metrics', () => {
  it('requests counts through the tenant- and pipeline-scoped invoker RPC', async () => {
    rpc.mockResolvedValue({ data: [
      { stage_id: 'stage-a', record_count: 5, overdue_count: 2, missing_action_count: 3, unassigned_count: 1 },
    ], error: null });
    const rows = await getManualPipelineMetrics(pipeline);
    expect(rows).toHaveLength(1);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('crm_manual_pipeline_metrics', {
      p_tenant_id: 'tenant-a', p_pipeline_id: 'pipeline-a',
    });
    expect(pipelineMetricsTotals(rows)).toEqual({ records: 5, overdue: 2, missingAction: 3, unassigned: 1 });
  });

  it('never reports connected-source records through generic CRM counts', async () => {
    await expect(getManualPipelineMetrics({ ...pipeline, source_mode: 'connected' }))
      .rejects.toThrow('authoritative source');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('fails visibly if the RLS-aware database function is unavailable', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } });
    await expect(getManualPipelineMetrics(pipeline)).rejects.toThrow('permission denied');
  });

  it('returns zero for an empty manual pipeline and sums all stages, including numeric string counts', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    expect(await getManualPipelineMetrics(pipeline)).toEqual([]);
    expect(pipelineMetricsTotals([])).toEqual({ records: 0, overdue: 0, missingAction: 0, unassigned: 0 });
    expect(pipelineMetricsTotals([
      { stage_id: 'a', record_count: 3, overdue_count: 1, missing_action_count: 2, unassigned_count: 0 },
      { stage_id: 'b', record_count: '4', overdue_count: '2', missing_action_count: '1', unassigned_count: '3' },
    ] as unknown as Awaited<ReturnType<typeof getManualPipelineMetrics>>)).toEqual({
      records: 7, overdue: 3, missingAction: 3, unassigned: 3,
    });
  });
});
