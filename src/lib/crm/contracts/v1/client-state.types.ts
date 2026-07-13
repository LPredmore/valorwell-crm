// Canonical Client State Contracts — v1
// SOURCE OF TRUTH for CRM. Do not read pat_status for business logic.
// Package version pinned via CONTRACT_VERSION in ./index.ts.

export type LifecycleStage =
  | 'Lead'
  | 'Registration'
  | 'Intake'
  | 'Matching'
  | 'Matched'
  | 'Scheduled'
  | 'Early Care'
  | 'Established Care'
  | 'Closed';

export type EngagementState =
  | 'Normal'
  | 'Unresponsive Warm'
  | 'Unresponsive Cold'
  | 'Went Dark';

export type EligibilityState =
  | 'Eligible'
  | 'Coverage Issue'
  | 'Manual Review'
  | 'Unknown';

export type ContactPolicy = 'Normal' | 'Do Not Contact';
export type ServicePolicy = 'Normal' | 'Service Blocked';
export type CareCadence = 'regular' | 'as_needed';

export type DispositionReason =
  | 'Not the Right Time'
  | 'Found Somewhere Else'
  | 'Completed Care'
  | 'Paused Care'
  | 'Administrative'
  | 'Went Dark'
  | 'Other';

export interface AtRiskState {
  at_risk: boolean;
  evaluated_at: string;
  recommended_next_action: string | null;
  event_version: string;
}

export interface ManualReviewContext {
  reason: string;
  owner: string;
  next_action: string;
  review_due_at: string;
}

/**
 * Canonical client state, read from v_client_canonical_state.
 * Never derived client-side.
 */
export interface CanonicalClientState {
  client_id: string;
  tenant_id: string;
  contract_version: string;
  lifecycle: LifecycleStage;
  engagement: EngagementState;
  at_risk: AtRiskState;
  eligibility: EligibilityState;
  eligibility_manual_review?: ManualReviewContext | null;
  contact_policy: ContactPolicy;
  service_policy: ServicePolicy;
  care_cadence: CareCadence;
  disposition_reason: DispositionReason | null;
  disposition_at: string | null;
  assigned_therapist_id: string | null;
  next_appointment_at: string | null;
  provider_demand_state:
    | 'none'
    | 'open'
    | 'options_available'
    | 'wait_active'
    | 'resolved';
  concurrency_token: string;
  updated_at: string;
}
