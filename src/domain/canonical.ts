/**
 * Canonical CRM domain model.
 *
 * These types are the application source of truth. They are intentionally
 * decoupled from the Supabase generated types. The future Supabase adapter
 * is responsible for mapping database enums into these values.
 *
 * DO NOT import Supabase generated types into this file.
 */

export const LIFECYCLE_STAGES = [
  'Registration',
  'Intake',
  'Matching',
  'Wait Path',
  'Scheduled',
  'Early Care',
  'Established Care',
  'Inactive',
  'Closed',
] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

export const ENGAGEMENT_STATES = ['Engaged', 'Warm', 'Cold', 'Went Dark'] as const;
export type EngagementState = (typeof ENGAGEMENT_STATES)[number];

export const ELIGIBILITY_STATES = [
  'Unknown',
  'Pending Verification',
  'Eligible',
  'Temporarily Ineligible',
  'Ineligible',
] as const;
export type EligibilityState = (typeof ELIGIBILITY_STATES)[number];

export const CONTACT_POLICIES = ['Contact Allowed', 'Do Not Contact'] as const;
export type ContactPolicy = (typeof CONTACT_POLICIES)[number];

export const SERVICE_POLICIES = ['Service Allowed', 'Service Blocked'] as const;
export type ServicePolicy = (typeof SERVICE_POLICIES)[number];

export const CARE_CADENCES = [
  'Not Set',
  'Weekly',
  'Every Two Weeks',
  'Monthly',
  'As Needed',
  'Temporarily Paused',
] as const;
export type CareCadence = (typeof CARE_CADENCES)[number];

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
  closureReason?: string;
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

export function displayName(c: Pick<CanonicalClient, 'preferredName' | 'legalFirstName' | 'legalLastName'>): string {
  if (c.preferredName?.trim()) return c.preferredName;
  return `${c.legalFirstName} ${c.legalLastName}`.trim();
}
