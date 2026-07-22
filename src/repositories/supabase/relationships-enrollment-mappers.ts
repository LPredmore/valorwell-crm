import type { Json } from '@/integrations/supabase/types';
import type {
  RelationshipCampaignEnrollment,
  RelationshipEnrollmentEligibility,
  RelationshipEnrollmentEligibilityReason,
  RelationshipEnrollmentEvent,
  RelationshipEnrollmentEventType,
  RelationshipEnrollmentStatus,
  RelationshipEnrollmentTarget,
} from '@/domain/relationships/enrollment-contracts';
import type { SourceLanguageMode } from '@/domain/relationships/contracts';

export type RelationshipEnrollmentRow = {
  id: string;
  tenant_id: string;
  campaign_id: string;
  contact_id: string;
  organization_id: string | null;
  opportunity_id: string | null;
  recipient_email: string;
  recipient_name: string | null;
  status: string;
  current_step_position: number | null;
  next_scheduled_at: string | null;
  stopped_reason: string | null;
  responded_at: string | null;
  source_language_mode: string;
  personalization_context: Json;
  eligibility_snapshot: Json;
  safety_status: string;
  delivery_enabled: boolean;
  version: number;
  enrolled_by_profile_id: string | null;
  created_by_profile_id: string | null;
  updated_by_profile_id: string | null;
  created_at: string;
  updated_at: string;
};

export type RelationshipEnrollmentEventRow = {
  id: string;
  tenant_id: string;
  enrollment_id: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  reason: string | null;
  occurred_at: string;
  actor_profile_id: string | null;
  metadata: Json;
  created_at: string;
};

type JsonObject = { [key: string]: Json | undefined };

function object(value: Json | undefined): JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
}

function stringValue(value: Json | undefined) {
  return typeof value === 'string' ? value : undefined;
}

function booleanValue(value: Json | undefined) {
  return typeof value === 'boolean' ? value : undefined;
}

function stringArray(value: Json | undefined) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function record(value: Json | undefined): Record<string, unknown> {
  return object(value) as Record<string, unknown>;
}

export function mapRelationshipEnrollmentEligibility(value: Json): RelationshipEnrollmentEligibility {
  const item = object(value);
  const targetValue = object(item.target);
  return {
    target: {
      contactId: stringValue(targetValue.contactId),
      organizationId: stringValue(targetValue.organizationId),
      opportunityId: stringValue(targetValue.opportunityId),
      sourceLanguageMode: stringValue(targetValue.sourceLanguageMode) as SourceLanguageMode | undefined,
      verifiedReferralId: stringValue(targetValue.verifiedReferralId),
    } satisfies RelationshipEnrollmentTarget,
    eligible: booleanValue(item.eligible) === true,
    reasons: stringArray(item.reasons) as RelationshipEnrollmentEligibilityReason[],
    resolvedContactId: stringValue(item.resolvedContactId),
    organizationId: stringValue(item.organizationId),
    opportunityId: stringValue(item.opportunityId),
    verifiedReferralId: stringValue(item.verifiedReferralId),
    recipientEmail: stringValue(item.recipientEmail),
    recipientName: stringValue(item.recipientName),
    sourceLanguageMode: (stringValue(item.sourceLanguageMode) ?? 'none') as SourceLanguageMode,
    personalizationContext: record(item.personalizationContext),
    evaluatedAt: stringValue(item.evaluatedAt),
    safetyStatus: 'pending_pass_11',
    safetyEligible: false,
    deliveryEnabled: false,
    executionEnabled: false,
    executionBoundary: 'disabled_until_passes_11_12',
  };
}

export function mapRelationshipEnrollmentResponse(value: Json): RelationshipCampaignEnrollment {
  const item = object(value);
  const eligibility = mapRelationshipEnrollmentEligibility(item.eligibilitySnapshot ?? {});
  return {
    id: requiredString(item.id, 'enrollment id'),
    campaignId: requiredString(item.campaignId, 'campaign id'),
    contactId: requiredString(item.contactId, 'contact id'),
    organizationId: stringValue(item.organizationId),
    opportunityId: stringValue(item.opportunityId),
    recipientEmail: requiredString(item.recipientEmail, 'recipient email'),
    recipientName: stringValue(item.recipientName),
    status: requiredString(item.status, 'enrollment status') as RelationshipEnrollmentStatus,
    currentStepPosition: numberValue(item.currentStepPosition),
    nextScheduledAt: stringValue(item.nextScheduledAt),
    stoppedReason: stringValue(item.stoppedReason),
    respondedAt: stringValue(item.respondedAt),
    sourceLanguageMode: (stringValue(item.sourceLanguageMode) ?? 'none') as SourceLanguageMode,
    personalizationContext: record(item.personalizationContext),
    eligibilitySnapshot: eligibility,
    safetyStatus: 'pending_pass_11',
    deliveryEnabled: false,
    version: numberValue(item.version) ?? 1,
    enrolledBy: stringValue(item.enrolledBy),
    createdAt: requiredString(item.createdAt, 'created timestamp'),
    updatedAt: requiredString(item.updatedAt, 'updated timestamp'),
    createdBy: stringValue(item.createdBy),
    updatedBy: stringValue(item.updatedBy),
  };
}

export function mapRelationshipEnrollmentRow(row: RelationshipEnrollmentRow): RelationshipCampaignEnrollment {
  return mapRelationshipEnrollmentResponse({
    id: row.id,
    campaignId: row.campaign_id,
    contactId: row.contact_id,
    organizationId: row.organization_id,
    opportunityId: row.opportunity_id,
    recipientEmail: row.recipient_email,
    recipientName: row.recipient_name,
    status: row.status,
    currentStepPosition: row.current_step_position,
    nextScheduledAt: row.next_scheduled_at,
    stoppedReason: row.stopped_reason,
    respondedAt: row.responded_at,
    sourceLanguageMode: row.source_language_mode,
    personalizationContext: row.personalization_context,
    eligibilitySnapshot: row.eligibility_snapshot,
    safetyStatus: row.safety_status,
    deliveryEnabled: row.delivery_enabled,
    version: row.version,
    enrolledBy: row.enrolled_by_profile_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by_profile_id,
    updatedBy: row.updated_by_profile_id,
  });
}

export function mapRelationshipEnrollmentEventRow(row: RelationshipEnrollmentEventRow): RelationshipEnrollmentEvent {
  return {
    id: row.id,
    enrollmentId: row.enrollment_id,
    eventType: row.event_type as RelationshipEnrollmentEventType,
    fromStatus: row.from_status ? row.from_status as RelationshipEnrollmentStatus : undefined,
    toStatus: row.to_status ? row.to_status as RelationshipEnrollmentStatus : undefined,
    reason: row.reason ?? undefined,
    occurredAt: row.occurred_at,
    actorId: row.actor_profile_id ?? undefined,
    metadata: record(row.metadata),
    createdAt: row.created_at,
  };
}

function requiredString(value: Json | undefined, label: string) {
  const result = stringValue(value);
  if (!result) throw new Error(`Invalid relationship ${label}.`);
  return result;
}

function numberValue(value: Json | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
