import { supabase } from '@/integrations/supabase/client';
import type { OperatorActivityType, RelationshipIntegrity, RelationshipOrchestration } from '@/domain/relationships/orchestration-contracts';

async function rpc<T>(name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await (supabase.rpc as unknown as (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>)(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export function getOpportunityOrchestration(opportunityId: string) {
  return rpc<RelationshipOrchestration>('get_relationship_opportunity_orchestration', { p_opportunity_id: opportunityId });
}

export function getRelationshipIntegrity() {
  return rpc<RelationshipIntegrity>('list_relationship_orchestration_integrity');
}

export function listFeatureFlags() {
  return rpc<ActivationFlag[]>('list_relationship_feature_flags');
}

export function setFeatureFlag(flagName: string, enabled: boolean, reason: string) {
  return rpc('set_relationship_feature_flag', {
    p_flag_name: flagName,
    p_enabled: enabled,
    p_reason: reason,
  });
}

export function previewBtyReconciliation() {
  return rpc<ReconciliationProposal[]>('preview_relationship_bty_reconciliation');
}

export function applyBtyReconciliation(items: ReconciliationProposal[]) {
  return rpc('apply_relationship_bty_reconciliation', {
    p_batch_id: crypto.randomUUID(),
    p_items: items,
  });
}


export function recordOperatorActivity(opportunityId: string, activityType: OperatorActivityType, metadata: Record<string, unknown> = {}) {
  return rpc('record_relationship_operator_activity', {
    p_opportunity_id: opportunityId,
    p_activity_type: activityType,
    p_idempotency_key: `crm:${activityType}:${opportunityId}:${crypto.randomUUID()}`,
    p_metadata: metadata,
  });
}

export function retryAutoEnrollment(opportunityId: string) {
  return rpc('retry_relationship_bty_auto_enrollment', {
    p_opportunity_id: opportunityId,
    p_idempotency_key: `crm:auto-enrollment-retry:${opportunityId}:${crypto.randomUUID()}`,
  });
}

export function resolveReconciliationIssue(issueId: string, status: 'resolved' | 'ignored', resolution: string) {
  return rpc('resolve_relationship_reconciliation_issue', { p_issue_id: issueId, p_status: status, p_resolution: resolution });
}

export async function startGoogleConnection(connectionType: 'gmail' | 'calendar') {
  const { data, error } = await supabase.functions.invoke('relationship-google-oauth-start', { body: { connectionType } });
  if (error) throw new Error(error.message);
  if (!data?.authorizationUrl) throw new Error(data?.error ?? 'Google authorization URL was not returned.');
  window.location.assign(data.authorizationUrl);
}
