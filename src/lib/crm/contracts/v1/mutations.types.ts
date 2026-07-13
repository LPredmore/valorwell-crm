// Canonical write RPC contracts — v1
// Every admin mutation MUST route through one of these RPCs.
// No direct UPDATE on clients from the CRM app.

import type {
  LifecycleStage,
  EngagementState,
  ContactPolicy,
  ServicePolicy,
  EligibilityState,
  CareCadence,
  DispositionReason,
} from './client-state.types';

export interface MutationBase {
  client_id: string;
  tenant_id: string;
  reason: string;
  concurrency_token: string;
  contract_version: string;
}

export interface LifecycleTransitionInput extends MutationBase {
  to_stage: LifecycleStage;
  disposition_reason?: DispositionReason | null;
}

export interface EngagementSetInput extends MutationBase {
  to_state: EngagementState;
}

export interface ContactPolicySetInput extends MutationBase {
  to_policy: ContactPolicy;
}

export interface ServicePolicySetInput extends MutationBase {
  to_policy: ServicePolicy;
}

export interface EligibilitySetInput extends MutationBase {
  to_state: EligibilityState;
  manual_review?: {
    owner: string;
    next_action: string;
    review_due_at: string;
  };
}

export interface CareCadenceSetInput extends MutationBase {
  to_cadence: CareCadence;
}

export type MutationErrorCode =
  | 'unauthorized'
  | 'invalid_transition'
  | 'concurrency_conflict'
  | 'suppression_violation'
  | 'contract_version_mismatch'
  | 'unknown';

export interface MutationResult {
  ok: boolean;
  error_code?: MutationErrorCode;
  message?: string;
}

export const RPC = {
  transitionLifecycle: 'transition_client_lifecycle',
  setEngagement: 'set_client_engagement_state',
  setContactPolicy: 'set_client_contact_policy',
  setServicePolicy: 'set_client_service_policy',
  setEligibility: 'set_client_eligibility_state',
  setCareCadence: 'set_client_care_cadence',
  setDisposition: 'set_client_disposition',
} as const;
