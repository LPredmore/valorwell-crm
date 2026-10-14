import { supabase } from '@/integrations/supabase/client';
import type { CrmPipeline } from '@/domain/pipelines/models';

export interface PipelineStageMetrics {
  stage_id: string;
  record_count: number;
  overdue_count: number;
  missing_action_count: number;
  unassigned_count: number;
}
export interface PipelineMetricsTotals {
  records: number;
  overdue: number;
  missingAction: number;
  unassigned: number;
}

/**
 * Exact unfiltered counts for the entire MANUAL pipeline, not the loaded cards.
 * The underlying SECURITY INVOKER RPC enforces the caller's tenant RLS.
 */
export async function getManualPipelineMetrics(pipeline: CrmPipeline): Promise<PipelineStageMetrics[]> {
  if (pipeline.source_mode !== 'manual') throw new Error('Connected pipeline counts belong to the authoritative source.');
  const { data, error } = await supabase.rpc('crm_manual_pipeline_metrics' as never, {
    p_tenant_id: pipeline.tenant_id,
    p_pipeline_id: pipeline.id,
  } as never);
  if (error) throw new Error('Pipeline totals unavailable: ' + error.message);
  return (data ?? []) as PipelineStageMetrics[];
}

export function pipelineMetricsTotals(rows: PipelineStageMetrics[]): PipelineMetricsTotals {
  return rows.reduce((total, row) => ({
    records: total.records + Number(row.record_count),
    overdue: total.overdue + Number(row.overdue_count),
    missingAction: total.missingAction + Number(row.missing_action_count),
    unassigned: total.unassigned + Number(row.unassigned_count),
  }), { records: 0, overdue: 0, missingAction: 0, unassigned: 0 });
}
