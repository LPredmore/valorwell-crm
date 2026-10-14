import { supabase } from '@/integrations/supabase/client';
import type { CrmPipeline, CrmPipelineRecord, CrmPipelineStage } from '@/domain/pipelines/models';

/** Only non-clinical, tenant-scoped CRM history is read here. */
export type PipelineStageHistoryRow = {
  id: string;
  from_stage_id: string | null;
  to_stage_id: string;
  occurred_at: string;
};
export type PipelineInteractionHistoryRow = {
  id: string;
  interaction_type: string;
  summary: string;
  occurred_at: string;
};
export type PipelineRecordHistory = {
  stages: PipelineStageHistoryRow[];
  interactions: PipelineInteractionHistoryRow[];
};
export type PipelineHistoryItem = {
  id: string;
  type: 'stage' | 'interaction';
  occurredAt: string;
  title: string;
  detail: string;
};

/**
 * Read strictly the selected manual pipeline record and its CRM subject.
 * The underlying tables independently enforce authenticated tenant RLS.
 * Both collections are bounded to the 50 newest items; no clinical tables
 * or arbitrary free-text metadata are queried.
 */
export async function getPipelineRecordHistory(
  pipeline: CrmPipeline,
  record: CrmPipelineRecord,
): Promise<PipelineRecordHistory> {
  if (pipeline.source_mode !== 'manual' || pipeline.tenant_id !== record.tenant_id
    || pipeline.id !== record.pipeline_id) {
    throw new Error('Record does not belong to the selected manual pipeline.');
  }
  const subjectField = pipeline.subject_type === 'person' ? 'contact_id' : 'organization_id';
  const subjectId = pipeline.subject_type === 'person' ? record.contact_id : record.organization_id;
  if (!subjectId) throw new Error('Pipeline record has no matching CRM subject.');

  const [stages, interactions] = await Promise.all([
    supabase.from('crm_pipeline_stage_events')
      .select('id,from_stage_id,to_stage_id,occurred_at')
      .eq('tenant_id', pipeline.tenant_id)
      .eq('pipeline_id', pipeline.id)
      .eq('record_id', record.id)
      .order('occurred_at', { ascending: false })
      .limit(50),
    supabase.from('relationship_interactions')
      .select('id,interaction_type,summary,occurred_at')
      .eq('tenant_id', pipeline.tenant_id)
      .eq(subjectField, subjectId)
      .order('occurred_at', { ascending: false })
      .limit(50),
  ]);
  if (stages.error) throw new Error('Stage history unavailable: ' + stages.error.message);
  if (interactions.error) throw new Error('CRM interaction history unavailable: ' + interactions.error.message);
  return {
    stages: (stages.data ?? []) as PipelineStageHistoryRow[],
    interactions: (interactions.data ?? []) as PipelineInteractionHistoryRow[],
  };
}

/** Present the two independently sourced, bounded event streams in time order. */
export function buildPipelineRecordTimeline(
  history: PipelineRecordHistory,
  stages: CrmPipelineStage[],
): PipelineHistoryItem[] {
  const names = new Map(stages.map(stage => [stage.id, stage.name]));
  const stageItems: PipelineHistoryItem[] = history.stages.map(event => ({
    id: 'stage:' + event.id,
    type: 'stage',
    occurredAt: event.occurred_at,
    title: event.from_stage_id ? 'Stage changed' : 'Entered pipeline',
    detail: (event.from_stage_id
      ? (names.get(event.from_stage_id) ?? 'Previous stage') + ' → '
      : '') + (names.get(event.to_stage_id) ?? 'Unknown stage'),
  }));
  const interactionItems: PipelineHistoryItem[] = history.interactions.map(event => ({
    id: 'interaction:' + event.id,
    type: 'interaction',
    occurredAt: event.occurred_at,
    title: event.interaction_type.replace(/_/g, ' '),
    detail: event.summary,
  }));
  return [...stageItems, ...interactionItems].sort(
    (a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id),
  );
}
