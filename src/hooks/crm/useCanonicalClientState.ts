import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { useCrmAuth } from './useCrmAuth';
import {
  CANONICAL_READ_VIEW,
  CONTRACT_VERSION,
  type AtRiskState,
  type CareCadence,
  type CanonicalClientState,
  type ContactPolicy,
  type DispositionReason,
  type EligibilityState,
  type EngagementState,
  type LifecycleStage,
  type ManualReviewContext,
  type ServicePolicy,
} from '@/lib/crm/contracts';

export type CanonicalReadStatus = 'ok' | 'CONTRACT_NOT_DEPLOYED' | 'empty';

export interface CanonicalReadResult<T> {
  status: CanonicalReadStatus;
  data: T | null;
  message?: string;
}


type CanonicalStateRow = Database['public']['Views']['v_client_canonical_state']['Row'];

function requireString(value: string | null, field: string): string {
  if (!value) {
    throw new Error(`Canonical state missing required ${field}`);
  }
  return value;
}

function parseLifecycle(value: string | null): LifecycleStage {
  switch (requireString(value, 'lifecycle')) {
    case 'Lead': return 'Lead';
    case 'Registration': return 'Registration';
    case 'Intake': return 'Intake';
    case 'Matching': return 'Matching';
    case 'Matched': return 'Matched';
    case 'Scheduled': return 'Scheduled';
    case 'Early Care': return 'Early Care';
    case 'Established Care': return 'Established Care';
    case 'Closed': return 'Closed';
    default: throw new Error(`Canonical state has invalid lifecycle: ${value}`);
  }
}

function parseEngagement(value: string | null): EngagementState {
  switch (requireString(value, 'engagement')) {
    case 'Normal': return 'Normal';
    case 'Unresponsive Warm': return 'Unresponsive Warm';
    case 'Unresponsive Cold': return 'Unresponsive Cold';
    case 'Went Dark': return 'Went Dark';
    default: throw new Error(`Canonical state has invalid engagement: ${value}`);
  }
}

function parseEligibility(value: string | null): EligibilityState {
  switch (requireString(value, 'eligibility')) {
    case 'Eligible': return 'Eligible';
    case 'Coverage Issue': return 'Coverage Issue';
    case 'Manual Review': return 'Manual Review';
    case 'Unknown': return 'Unknown';
    default: throw new Error(`Canonical state has invalid eligibility: ${value}`);
  }
}

function parseContactPolicy(value: string | null): ContactPolicy {
  switch (requireString(value, 'contact_policy')) {
    case 'Normal': return 'Normal';
    case 'Do Not Contact': return 'Do Not Contact';
    default: throw new Error(`Canonical state has invalid contact policy: ${value}`);
  }
}

function parseServicePolicy(value: string | null): ServicePolicy {
  switch (requireString(value, 'service_policy')) {
    case 'Normal': return 'Normal';
    case 'Service Blocked': return 'Service Blocked';
    default: throw new Error(`Canonical state has invalid service policy: ${value}`);
  }
}

function parseCareCadence(value: string | null): CareCadence {
  switch (requireString(value, 'care_cadence')) {
    case 'regular': return 'regular';
    case 'as_needed': return 'as_needed';
    default: throw new Error(`Canonical state has invalid care cadence: ${value}`);
  }
}

function parseDispositionReason(value: string | null): DispositionReason | null {
  switch (value) {
    case null: return null;
    case 'Not the Right Time': return 'Not the Right Time';
    case 'Found Somewhere Else': return 'Found Somewhere Else';
    case 'Completed Care': return 'Completed Care';
    case 'Paused Care': return 'Paused Care';
    case 'Administrative': return 'Administrative';
    case 'Went Dark': return 'Went Dark';
    case 'Other': return 'Other';
    default: throw new Error(`Canonical state has invalid disposition reason: ${value}`);
  }
}

function parseAtRisk(value: CanonicalStateRow['at_risk']): AtRiskState {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Canonical state has invalid at_risk payload');
  }
  const atRisk = value.at_risk;
  const evaluatedAt = value.evaluated_at;
  const recommendedNextActionValue = value.recommended_next_action;
  const eventVersion = value.event_version;
  if (
    typeof atRisk !== 'boolean' ||
    typeof evaluatedAt !== 'string' ||
    (recommendedNextActionValue !== null && typeof recommendedNextActionValue !== 'string') ||
    typeof eventVersion !== 'string'
  ) {
    throw new Error('Canonical state has invalid at_risk payload');
  }
  const recommendedNextAction = typeof recommendedNextActionValue === 'string' ? recommendedNextActionValue : null;
  return {
    at_risk: atRisk,
    evaluated_at: evaluatedAt,
    recommended_next_action: recommendedNextAction,
    event_version: eventVersion,
  };
}

function parseManualReview(value: CanonicalStateRow['eligibility_manual_review']): ManualReviewContext | null {
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Canonical state has invalid eligibility_manual_review payload');
  }
  const reason = value.reason;
  const owner = value.owner;
  const nextAction = value.next_action;
  const reviewDueAt = value.review_due_at;
  if (
    typeof reason !== 'string' ||
    typeof owner !== 'string' ||
    typeof nextAction !== 'string' ||
    typeof reviewDueAt !== 'string'
  ) {
    throw new Error('Canonical state has invalid eligibility_manual_review payload');
  }
  return { reason, owner, next_action: nextAction, review_due_at: reviewDueAt };
}

function parseProviderDemandState(
  value: string | null,
): CanonicalClientState['provider_demand_state'] {
  switch (requireString(value, 'provider_demand_state')) {
    case 'none': return 'none';
    case 'open': return 'open';
    case 'options_available': return 'options_available';
    case 'wait_active': return 'wait_active';
    case 'resolved': return 'resolved';
    default: throw new Error(`Canonical state has invalid provider demand state: ${value}`);
  }
}

function toCanonicalClientState(row: CanonicalStateRow): CanonicalClientState {
  return {
    client_id: requireString(row.client_id, 'client_id'),
    tenant_id: requireString(row.tenant_id, 'tenant_id'),
    contract_version: requireString(row.contract_version, 'contract_version'),
    lifecycle: parseLifecycle(row.lifecycle),
    engagement: parseEngagement(row.engagement),
    at_risk: parseAtRisk(row.at_risk),
    eligibility: parseEligibility(row.eligibility),
    eligibility_manual_review: parseManualReview(row.eligibility_manual_review),
    contact_policy: parseContactPolicy(row.contact_policy),
    service_policy: parseServicePolicy(row.service_policy),
    care_cadence: parseCareCadence(row.care_cadence),
    disposition_reason: parseDispositionReason(row.disposition_reason),
    disposition_at: row.disposition_at,
    assigned_therapist_id: row.assigned_therapist_id,
    next_appointment_at: row.next_appointment_at,
    provider_demand_state: parseProviderDemandState(row.provider_demand_state),
    concurrency_token: requireString(row.concurrency_token, 'concurrency_token'),
    updated_at: requireString(row.updated_at, 'updated_at'),
  };
}

function classifyError(message: string): CanonicalReadStatus {
  if (
    /relation .* does not exist/i.test(message) ||
    /could not find the table/i.test(message) ||
    /PGRST20[12]/i.test(message)
  ) {
    return 'CONTRACT_NOT_DEPLOYED';
  }
  return 'CONTRACT_NOT_DEPLOYED';
}

/**
 * Reads the authoritative canonical state for a client.
 * Never reads legacy status columns. Never derives lifecycle/engagement/at-risk client-side.
 * Fail-closed: returns explicit CONTRACT_NOT_DEPLOYED status when the backend
 * view is missing, instead of silently returning null.
 */
export function useCanonicalClientState(clientId: string | undefined | null) {
  const { tenantId, isAuthenticated } = useCrmAuth();

  return useQuery({
    queryKey: ['canonical-client-state', tenantId, clientId, CONTRACT_VERSION],
    enabled: isAuthenticated && !!tenantId && !!clientId,
    queryFn: async (): Promise<CanonicalReadResult<CanonicalClientState>> => {
      const { data, error } = await supabase
        .from(CANONICAL_READ_VIEW)
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('client_id', clientId)
        .maybeSingle();

      if (error) {
        console.warn(`[canonical] ${CANONICAL_READ_VIEW} unavailable:`, error.message);
        return {
          status: classifyError(error.message),
          data: null,
          message: error.message,
        };
      }
      return { status: data ? 'ok' : 'empty', data: data ? toCanonicalClientState(data) : null };
    },
  });
}

/**
 * Batch read for list/kanban surfaces.
 */
export function useCanonicalClientStates(clientIds: string[]) {
  const { tenantId, isAuthenticated } = useCrmAuth();
  const key = clientIds.slice().sort().join(',');

  return useQuery({
    queryKey: ['canonical-client-states', tenantId, key, CONTRACT_VERSION],
    enabled: isAuthenticated && !!tenantId && clientIds.length > 0,
    queryFn: async (): Promise<CanonicalReadResult<Record<string, CanonicalClientState>>> => {
      const { data, error } = await supabase
        .from(CANONICAL_READ_VIEW)
        .select('*')
        .eq('tenant_id', tenantId)
        .in('client_id', clientIds);

      if (error) {
        console.warn(`[canonical] ${CANONICAL_READ_VIEW} unavailable:`, error.message);
        return {
          status: classifyError(error.message),
          data: null,
          message: error.message,
        };
      }
      const out: Record<string, CanonicalClientState> = {};
      for (const row of data ?? []) {
        const canonical = toCanonicalClientState(row);
        out[canonical.client_id] = canonical;
      }
      return { status: 'ok', data: out };
    },
  });
}
