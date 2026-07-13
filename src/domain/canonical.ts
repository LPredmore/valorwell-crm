/**
 * Canonical CRM domain model.
 *
 * SOURCE OF TRUTH: the live Supabase enums in `public`:
 *   - client_lifecycle_stage_enum
 *   - client_engagement_state_enum
 *   - client_eligibility_state_enum
 *   - client_contact_policy_enum
 *   - client_service_policy_enum
 *   - client_care_cadence_enum
 *   - client_closure_reason_enum
 *
 * The domain uses friendly display-form labels; database values (snake_case)
 * are converted at the repository boundary via the mappers at the bottom of
 * this file. Never persist the display labels; never surface the raw db
 * values in the UI. Mappers throw on unknown values — do not silently coerce.
 */

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
export const LIFECYCLE_STAGES = [
  'Registration',
  'Intake',
  'Matching',
  'Matched',
  'Scheduled',
  'Early Care',
  'Established Care',
  'Closed',
] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

export type DbLifecycleStage =
  | 'registration'
  | 'intake'
  | 'matching'
  | 'matched'
  | 'scheduled'
  | 'early_care'
  | 'established_care'
  | 'closed';

const LIFECYCLE_DB_TO_DOMAIN: Record<DbLifecycleStage, LifecycleStage> = {
  registration: 'Registration',
  intake: 'Intake',
  matching: 'Matching',
  matched: 'Matched',
  scheduled: 'Scheduled',
  early_care: 'Early Care',
  established_care: 'Established Care',
  closed: 'Closed',
};
const LIFECYCLE_DOMAIN_TO_DB: Record<LifecycleStage, DbLifecycleStage> = {
  Registration: 'registration',
  Intake: 'intake',
  Matching: 'matching',
  Matched: 'matched',
  Scheduled: 'scheduled',
  'Early Care': 'early_care',
  'Established Care': 'established_care',
  Closed: 'closed',
};

// ---------------------------------------------------------------------------
// Engagement
// ---------------------------------------------------------------------------
export const ENGAGEMENT_STATES = ['Engaged', 'Warm', 'Cold', 'Went Dark'] as const;
export type EngagementState = (typeof ENGAGEMENT_STATES)[number];

export type DbEngagementState =
  | 'normal'
  | 'unresponsive_warm'
  | 'unresponsive_cold'
  | 'went_dark';

const ENGAGEMENT_DB_TO_DOMAIN: Record<DbEngagementState, EngagementState> = {
  normal: 'Engaged',
  unresponsive_warm: 'Warm',
  unresponsive_cold: 'Cold',
  went_dark: 'Went Dark',
};
const ENGAGEMENT_DOMAIN_TO_DB: Record<EngagementState, DbEngagementState> = {
  Engaged: 'normal',
  Warm: 'unresponsive_warm',
  Cold: 'unresponsive_cold',
  'Went Dark': 'went_dark',
};

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------
export const ELIGIBILITY_STATES = [
  'Eligible',
  'Coverage Issue',
  'Manual Review',
  'Unknown',
] as const;
export type EligibilityState = (typeof ELIGIBILITY_STATES)[number];

export type DbEligibilityState = 'eligible' | 'coverage_issue' | 'manual_review' | 'unknown';

const ELIGIBILITY_DB_TO_DOMAIN: Record<DbEligibilityState, EligibilityState> = {
  eligible: 'Eligible',
  coverage_issue: 'Coverage Issue',
  manual_review: 'Manual Review',
  unknown: 'Unknown',
};
const ELIGIBILITY_DOMAIN_TO_DB: Record<EligibilityState, DbEligibilityState> = {
  Eligible: 'eligible',
  'Coverage Issue': 'coverage_issue',
  'Manual Review': 'manual_review',
  Unknown: 'unknown',
};

// ---------------------------------------------------------------------------
// Contact policy
// ---------------------------------------------------------------------------
export const CONTACT_POLICIES = ['Contact Allowed', 'Do Not Contact'] as const;
export type ContactPolicy = (typeof CONTACT_POLICIES)[number];

export type DbContactPolicy = 'normal' | 'do_not_contact';

const CONTACT_POLICY_DB_TO_DOMAIN: Record<DbContactPolicy, ContactPolicy> = {
  normal: 'Contact Allowed',
  do_not_contact: 'Do Not Contact',
};
const CONTACT_POLICY_DOMAIN_TO_DB: Record<ContactPolicy, DbContactPolicy> = {
  'Contact Allowed': 'normal',
  'Do Not Contact': 'do_not_contact',
};

// ---------------------------------------------------------------------------
// Service policy
// ---------------------------------------------------------------------------
export const SERVICE_POLICIES = ['Service Allowed', 'Service Blocked'] as const;
export type ServicePolicy = (typeof SERVICE_POLICIES)[number];

export type DbServicePolicy = 'normal' | 'service_blocked';

const SERVICE_POLICY_DB_TO_DOMAIN: Record<DbServicePolicy, ServicePolicy> = {
  normal: 'Service Allowed',
  service_blocked: 'Service Blocked',
};
const SERVICE_POLICY_DOMAIN_TO_DB: Record<ServicePolicy, DbServicePolicy> = {
  'Service Allowed': 'normal',
  'Service Blocked': 'service_blocked',
};

// ---------------------------------------------------------------------------
// Care cadence
// ---------------------------------------------------------------------------
export const CARE_CADENCES = ['Regular', 'As Needed'] as const;
export type CareCadence = (typeof CARE_CADENCES)[number];

export type DbCareCadence = 'regular' | 'as_needed';

const CARE_CADENCE_DB_TO_DOMAIN: Record<DbCareCadence, CareCadence> = {
  regular: 'Regular',
  as_needed: 'As Needed',
};
const CARE_CADENCE_DOMAIN_TO_DB: Record<CareCadence, DbCareCadence> = {
  Regular: 'regular',
  'As Needed': 'as_needed',
};

// ---------------------------------------------------------------------------
// Closure reason
// ---------------------------------------------------------------------------
export const CLOSURE_REASONS = [
  'Not the Right Time',
  'Found Somewhere Else',
  'Completed Care',
  'Paused Care',
  'Administrative',
  'Went Dark',
  'Other',
] as const;
export type ClosureReason = (typeof CLOSURE_REASONS)[number];

export type DbClosureReason =
  | 'not_the_right_time'
  | 'found_somewhere_else'
  | 'completed_care'
  | 'paused_care'
  | 'administrative'
  | 'went_dark'
  | 'other';

const CLOSURE_DB_TO_DOMAIN: Record<DbClosureReason, ClosureReason> = {
  not_the_right_time: 'Not the Right Time',
  found_somewhere_else: 'Found Somewhere Else',
  completed_care: 'Completed Care',
  paused_care: 'Paused Care',
  administrative: 'Administrative',
  went_dark: 'Went Dark',
  other: 'Other',
};
const CLOSURE_DOMAIN_TO_DB: Record<ClosureReason, DbClosureReason> = {
  'Not the Right Time': 'not_the_right_time',
  'Found Somewhere Else': 'found_somewhere_else',
  'Completed Care': 'completed_care',
  'Paused Care': 'paused_care',
  Administrative: 'administrative',
  'Went Dark': 'went_dark',
  Other: 'other',
};

// ---------------------------------------------------------------------------
// Risk and closure info (application-level)
// ---------------------------------------------------------------------------
export const RISK_SEVERITIES = ['Low', 'Moderate', 'High', 'Critical'] as const;
export type RiskSeverity = (typeof RISK_SEVERITIES)[number];

export interface RiskState {
  atRisk: boolean;
  atRiskSince?: string;
  reasons: string[];
  severity?: RiskSeverity;
  lastEvaluatedAt?: string;
  requiredNextAction?: string;
  ownerId?: string;
}

export interface ClosureInfo {
  closureReason?: ClosureReason;
  dispositionReason?: string;
  closedAt?: string;
  closedByProfileId?: string;
  notes?: string;
  reentryAllowed?: boolean;
  reentryInstructions?: string;
}

export interface CanonicalClient {
  id: string;
  tenantId: string;

  // Identity
  legalFirstName: string;
  legalMiddleName?: string;
  legalLastName: string;
  preferredName?: string;
  pronouns?: string;
  dateOfBirth?: string;

  // Contact
  email?: string;
  phone?: string;
  state?: string;

  // Assignment
  assignedClinicianId?: string;
  assignedOperationsOwnerId?: string;

  // Canonical state dimensions
  lifecycle: LifecycleStage;
  engagement: EngagementState;
  eligibility: EligibilityState;
  contactPolicy: ContactPolicy;
  servicePolicy: ServicePolicy;
  careCadence: CareCadence;
  risk: RiskState;
  closure?: ClosureInfo;

  // Program / payer
  payer?: string;
  program?: string;

  // Activity
  lastContactAt?: string;
  lastContactChannel?: 'email' | 'sms' | 'phone' | 'note';
  lastContactDirection?: 'inbound' | 'outbound';
  nextAppointmentAt?: string;
  nextRequiredAction?: string;
  activeCampaignId?: string;
  openTaskCount: number;

  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export function displayName(
  c: Pick<CanonicalClient, 'preferredName' | 'legalFirstName' | 'legalLastName'>,
): string {
  if (c.preferredName?.trim()) return c.preferredName;
  return `${c.legalFirstName} ${c.legalLastName}`.trim();
}

// ---------------------------------------------------------------------------
// Mappers (throw on unknown values — never silently default)
// ---------------------------------------------------------------------------
function pick<K extends string, V>(map: Record<K, V>, key: string, kind: string): V {
  const v = (map as Record<string, V>)[key];
  if (v === undefined) throw new Error(`Unknown ${kind} value from database: ${key}`);
  return v;
}

export const mapDbLifecycleToDomain = (v: string): LifecycleStage =>
  pick(LIFECYCLE_DB_TO_DOMAIN, v, 'lifecycle');
export const mapDomainLifecycleToDb = (v: LifecycleStage): DbLifecycleStage =>
  LIFECYCLE_DOMAIN_TO_DB[v];

export const mapDbEngagementToDomain = (v: string): EngagementState =>
  pick(ENGAGEMENT_DB_TO_DOMAIN, v, 'engagement');
export const mapDomainEngagementToDb = (v: EngagementState): DbEngagementState =>
  ENGAGEMENT_DOMAIN_TO_DB[v];

export const mapDbEligibilityToDomain = (v: string): EligibilityState =>
  pick(ELIGIBILITY_DB_TO_DOMAIN, v, 'eligibility');
export const mapDomainEligibilityToDb = (v: EligibilityState): DbEligibilityState =>
  ELIGIBILITY_DOMAIN_TO_DB[v];

export const mapDbContactPolicyToDomain = (v: string): ContactPolicy =>
  pick(CONTACT_POLICY_DB_TO_DOMAIN, v, 'contact policy');
export const mapDomainContactPolicyToDb = (v: ContactPolicy): DbContactPolicy =>
  CONTACT_POLICY_DOMAIN_TO_DB[v];

export const mapDbServicePolicyToDomain = (v: string): ServicePolicy =>
  pick(SERVICE_POLICY_DB_TO_DOMAIN, v, 'service policy');
export const mapDomainServicePolicyToDb = (v: ServicePolicy): DbServicePolicy =>
  SERVICE_POLICY_DOMAIN_TO_DB[v];

export const mapDbCareCadenceToDomain = (v: string): CareCadence =>
  pick(CARE_CADENCE_DB_TO_DOMAIN, v, 'care cadence');
export const mapDomainCareCadenceToDb = (v: CareCadence): DbCareCadence =>
  CARE_CADENCE_DOMAIN_TO_DB[v];

export const mapDbClosureReasonToDomain = (v: string): ClosureReason =>
  pick(CLOSURE_DB_TO_DOMAIN, v, 'closure reason');
export const mapDomainClosureReasonToDb = (v: ClosureReason): DbClosureReason =>
  CLOSURE_DOMAIN_TO_DB[v];
