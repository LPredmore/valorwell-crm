import type { Database } from '@/integrations/supabase/types';
import {
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

export type CanonicalStateRow = Database['public']['Views']['v_client_canonical_state']['Row'];

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) {
    throw new Error(`Canonical state missing required ${field}`);
  }
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error(`Canonical state has invalid ${field} payload`);
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
  if (typeof atRisk !== 'boolean') {
    throw new Error('Canonical state has invalid at_risk payload');
  }

  const evaluatedAt = optionalString(value.evaluated_at, 'at_risk.evaluated_at');
  const eventVersion = optionalString(value.event_version, 'at_risk.event_version');
  const recommendedNextActionValue = value.recommended_next_action;
  if (
    recommendedNextActionValue !== undefined
    && recommendedNextActionValue !== null
    && typeof recommendedNextActionValue !== 'string'
  ) {
    throw new Error('Canonical state has invalid at_risk.recommended_next_action payload');
  }

  const parsed: AtRiskState = { at_risk: atRisk };
  if (evaluatedAt !== undefined) parsed.evaluated_at = evaluatedAt;
  if (recommendedNextActionValue === null) parsed.recommended_next_action = null;
  if (typeof recommendedNextActionValue === 'string') parsed.recommended_next_action = recommendedNextActionValue;
  if (eventVersion !== undefined) parsed.event_version = eventVersion;
  return parsed;
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
    typeof reason !== 'string'
    || typeof owner !== 'string'
    || typeof nextAction !== 'string'
    || typeof reviewDueAt !== 'string'
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

export function toCanonicalClientState(row: CanonicalStateRow): CanonicalClientState {
  const contractVersion = requireString(row.contract_version, 'contract_version');
  if (contractVersion !== CONTRACT_VERSION) {
    throw new Error(`Canonical contract version mismatch: expected ${CONTRACT_VERSION}, received ${contractVersion}`);
  }

  return {
    client_id: requireString(row.client_id, 'client_id'),
    tenant_id: requireString(row.tenant_id, 'tenant_id'),
    contract_version: contractVersion,
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

export function classifyError(message: string): CanonicalReadStatus | null {
  if (
    /relation .* does not exist/i.test(message)
    || /could not find the table/i.test(message)
    || /could not find the view/i.test(message)
    || /schema cache.*(table|view)/i.test(message)
    || /PGRST205/i.test(message)
  ) {
    return 'CONTRACT_NOT_DEPLOYED';
  }
  return null;
}

export function resolveCanonicalRead(
  data: CanonicalStateRow | null,
  error: { message: string } | null,
): CanonicalReadResult<CanonicalClientState> {
  if (error) {
    const status = classifyError(error.message);
    if (status) return { status, data: null, message: error.message };
    throw new Error(error.message);
  }
  return { status: data ? 'ok' : 'empty', data: data ? toCanonicalClientState(data) : null };
}
