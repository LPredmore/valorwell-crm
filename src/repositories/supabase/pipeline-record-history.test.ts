import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CrmPipeline, CrmPipelineRecord, CrmPipelineStage } from '@/domain/pipelines/models';

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from } }));
import { buildPipelineRecordTimeline, getPipelineRecordHistory } from './pipeline-record-history';

const pipeline = {
  id: 'pipeline-own', tenant_id: 'tenant-own', subject_type: 'person', source_mode: 'manual',
} as CrmPipeline;
const record = {
  id: 'record-own', pipeline_id: 'pipeline-own', tenant_id: 'tenant-own',
  contact_id: 'person-own', organization_id: null,
} as CrmPipelineRecord;

function makeQuery(data: unknown[], error: { message: string } | null = null) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data, error }),
  };
  return query;
}
beforeEach(() => vi.clearAllMocks());

describe('pipeline record history', () => {
  it('reads only selected tenant, pipeline, record and person, each capped at 50', async () => {
    const stageQuery = makeQuery([{ id: 's1', from_stage_id: null, to_stage_id: 'stage-a', occurred_at: '2026-10-14T10:00:00Z' }]);
    const interactionQuery = makeQuery([{ id: 'i1', interaction_type: 'phone_call', summary: 'Spoke', occurred_at: '2026-10-14T12:00:00Z' }]);
    from.mockImplementation((table: string) =>
      table === 'crm_pipeline_stage_events' ? stageQuery : interactionQuery);
    const history = await getPipelineRecordHistory(pipeline, record);
    expect(history.stages).toHaveLength(1);
    expect(history.interactions).toHaveLength(1);
    expect(from).toHaveBeenCalledWith('crm_pipeline_stage_events');
    expect(from).toHaveBeenCalledWith('relationship_interactions');
    expect(stageQuery.eq.mock.calls).toEqual([
      ['tenant_id', 'tenant-own'], ['pipeline_id', 'pipeline-own'], ['record_id', 'record-own'],
    ]);
    expect(interactionQuery.eq.mock.calls).toEqual([
      ['tenant_id', 'tenant-own'], ['contact_id', 'person-own'],
    ]);
    expect(stageQuery.limit).toHaveBeenCalledWith(50);
    expect(interactionQuery.limit).toHaveBeenCalledWith(50);
    expect(stageQuery.order).toHaveBeenCalledWith('occurred_at', { ascending: false });
    expect(interactionQuery.order).toHaveBeenCalledWith('occurred_at', { ascending: false });
    expect(stageQuery.select).toHaveBeenCalledWith('id,from_stage_id,to_stage_id,occurred_at');
    expect(interactionQuery.select).toHaveBeenCalledWith('id,interaction_type,summary,occurred_at');
  });

  it('uses organization identity, not associated organization, for organization pipeline history', async () => {
    const s = makeQuery([]);
    const i = makeQuery([]);
    from.mockImplementation((table: string) => table === 'crm_pipeline_stage_events' ? s : i);
    await getPipelineRecordHistory(
      { ...pipeline, subject_type: 'organization' },
      { ...record, contact_id: null, organization_id: 'org-own', associated_organization_id: 'org-different' },
    );
    expect(i.eq).toHaveBeenCalledWith('organization_id', 'org-own');
    expect(i.eq).not.toHaveBeenCalledWith('contact_id', expect.anything());
    expect(i.eq).not.toHaveBeenCalledWith('organization_id', 'org-different');
  });

  it('refuses mismatched tenant/pipeline, connected source, or missing subject before any queries', async () => {
    await expect(getPipelineRecordHistory(pipeline, { ...record, tenant_id: 'tenant-other' })).rejects.toThrow('does not belong');
    await expect(getPipelineRecordHistory(pipeline, { ...record, pipeline_id: 'pipeline-other' })).rejects.toThrow('does not belong');
    await expect(getPipelineRecordHistory({ ...pipeline, source_mode: 'connected' }, record)).rejects.toThrow('does not belong');
    await expect(getPipelineRecordHistory(pipeline, { ...record, contact_id: null })).rejects.toThrow('no matching CRM subject');
    expect(from).not.toHaveBeenCalled();
  });

  it('fails closed when either database query fails; does not show a misleading empty timeline', async () => {
    from.mockImplementation((table: string) => table === 'crm_pipeline_stage_events'
      ? makeQuery([], { message: 'Stage history access denied' }) : makeQuery([]));
    await expect(getPipelineRecordHistory(pipeline, record)).rejects.toThrow('Stage history access denied');
    from.mockImplementation((table: string) => table === 'relationship_interactions'
      ? makeQuery([], { message: 'Interaction access denied' }) : makeQuery([]));
    await expect(getPipelineRecordHistory(pipeline, record)).rejects.toThrow('Interaction access denied');
  });

  it('merges CRM stage and interaction events chronologically without clinical metadata', () => {
    const stage = { id: 'stage-1', name: 'Contacted' } as CrmPipelineStage;
    const stage2 = { id: 'stage-2', name: 'Screening' } as CrmPipelineStage;
    const items = buildPipelineRecordTimeline({
      stages: [
        { id: 'initial', from_stage_id: null, to_stage_id: 'stage-1', occurred_at: '2026-10-13T10:00:00Z' },
        { id: 'move', from_stage_id: 'stage-1', to_stage_id: 'stage-2', occurred_at: '2026-10-14T10:00:00Z' },
      ],
      interactions: [
        { id: 'call', interaction_type: 'phone_call', summary: 'Follow-up made', occurred_at: '2026-10-14T09:00:00Z' },
      ],
    }, [stage, stage2]);
    expect(items.map(x => x.id)).toEqual(['stage:move', 'interaction:call', 'stage:initial']);
    expect(items.map(x => x.detail)).toEqual(['Contacted → Screening', 'Follow-up made', 'Contacted']);
    expect(items[1].title).toBe('phone call');
  });
});
