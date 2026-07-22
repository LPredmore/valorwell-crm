import type { AuditMetadata, PageResult, SourceLanguageMode } from './contracts';

export const relationshipEnrollmentStatuses = [
  'pending',
  'active',
  'paused',
  'responded',
  'stopped',
  'completed',
  'failed',
  'suppressed',
] as const;
export type RelationshipEnrollmentStatus = (typeof relationshipEnrollmentStatuses)[number];

export const relationshipEnrollmentEventTypes = [
  'enrolled',
  'paused',
  'resumed',
  'stopped',
  'work_planned',
  'work_claimed',
  'work_retry_scheduled',
  'step_completed',
  'completed',
  'failed',
  'system',
] as const;
export type RelationshipEnrollmentEventType = (typeof relationshipEnrollmentEventTypes)[number];

export const relationshipEnrollmentEligibilityReasons = [
  'target_invalid',
  'campaign_not_found',
  'campaign_not_active',
  'opportunity_not_found',
  'opportunity_not_qualified',
  'review_not_approved',
  'organization_not_found',
  'contact_not_found',
  'recipient_contact_required',
  'recipient_contact_ambiguous',
  'contact_not_linked_to_organization',
  'target_context_conflict',
  'missing_email',
  'do_not_contact',
  'active_enrollment',
  'previous_response',
  'source_language_not_allowed',
] as const;
export type RelationshipEnrollmentEligibilityReason = (typeof relationshipEnrollmentEligibilityReasons)[number];

export type RelationshipEnrollmentTarget = {
  contactId?: string;
  organizationId?: string;
  opportunityId?: string;
  sourceLanguageMode?: SourceLanguageMode;
};

export type RelationshipEnrollmentEligibility = {
  target: RelationshipEnrollmentTarget;
  eligible: boolean;
  reasons: RelationshipEnrollmentEligibilityReason[];
  resolvedContactId?: string;
  organizationId?: string;
  opportunityId?: string;
  recipientEmail?: string;
  recipientName?: string;
  sourceLanguageMode: SourceLanguageMode;
  personalizationContext: Record<string, unknown>;
  evaluatedAt?: string;
  safetyStatus: 'pending_pass_11';
  safetyEligible: false;
  deliveryEnabled: false;
  executionEnabled: false;
  executionBoundary: 'disabled_until_passes_11_12';
};

export type RelationshipCampaignEnrollment = AuditMetadata & {
  id: string;
  campaignId: string;
  contactId: string;
  organizationId?: string;
  opportunityId?: string;
  recipientEmail: string;
  recipientName?: string;
  status: RelationshipEnrollmentStatus;
  currentStepPosition?: number;
  nextScheduledAt?: string;
  stoppedReason?: string;
  respondedAt?: string;
  sourceLanguageMode: SourceLanguageMode;
  personalizationContext: Record<string, unknown>;
  eligibilitySnapshot: RelationshipEnrollmentEligibility;
  safetyStatus: 'pending_pass_11';
  deliveryEnabled: false;
  version: number;
  enrolledBy?: string;
};

export type RelationshipEnrollmentEvent = {
  id: string;
  enrollmentId: string;
  eventType: RelationshipEnrollmentEventType;
  fromStatus?: RelationshipEnrollmentStatus;
  toStatus?: RelationshipEnrollmentStatus;
  reason?: string;
  occurredAt: string;
  actorId?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type RelationshipEnrollmentFilters = {
  statuses?: RelationshipEnrollmentStatus[];
  contactIds?: string[];
  page?: number;
  pageSize?: number;
};

export type RelationshipEnrollmentPage = PageResult<RelationshipCampaignEnrollment>;

export type EnrollRelationshipTargetsInput = {
  targets: RelationshipEnrollmentTarget[];
  expectedCampaignVersion: number;
  idempotencyKey?: string;
};

export type TransitionRelationshipEnrollmentInput = {
  status: 'pending' | 'paused' | 'stopped';
  expectedVersion: number;
  idempotencyKey?: string;
  reason?: string;
};

export function operatorEnrollmentTransitions(status: RelationshipEnrollmentStatus) {
  const transitions: Record<RelationshipEnrollmentStatus, Array<'pending' | 'paused' | 'stopped'>> = {
    pending: ['paused', 'stopped'],
    active: ['paused', 'stopped'],
    paused: ['pending', 'stopped'],
    responded: [],
    stopped: [],
    completed: [],
    failed: [],
    suppressed: [],
  };
  return transitions[status];
}
