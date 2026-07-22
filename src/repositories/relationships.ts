import type {
  Capability,
  CapabilityAvailability,
  CreateInteractionInput,
  CreateOpportunityInput,
  CreateReferralInput,
  InteractionFilters,
  OrganizationRole,
  PageResult,
  RelationshipInteraction,
  RelationshipOpportunity,
  RelationshipReportMetric,
  RelationshipSearchResult,
  RelationshipStage,
  RelationshipStageHistory,
  Referral,
  SocialProfile,
  UpdateOpportunityInput,
  UpdateReferralInput,
  VerifyReferralInput,
} from '@/domain/relationships/contracts';
import type {
  RelationshipCampaign,
  RelationshipCampaignDefinitionInput,
  RelationshipCampaignFilters,
  RelationshipCampaignPage,
  RelationshipCampaignTransitionInput,
} from '@/domain/relationships/campaign-contracts';
import type {
  RelationshipCampaignExecutionResult,
  RelationshipCommunication,
  RelationshipCommunicationEvent,
  RelationshipDeliveryReadiness,
  RelationshipReply,
  RelationshipReplyFilters,
  RelationshipReplyPage,
  SetRelationshipCampaignExecutionInput,
  UpdateRelationshipReplyInput,
} from '@/domain/relationships/delivery-contracts';
import type {
  EnrollRelationshipTargetsInput,
  RelationshipCampaignEnrollment,
  RelationshipEnrollmentEligibility,
  RelationshipEnrollmentEvent,
  RelationshipEnrollmentFilters,
  RelationshipEnrollmentPage,
  RelationshipEnrollmentTarget,
  TransitionRelationshipEnrollmentInput,
} from '@/domain/relationships/enrollment-contracts';
import type {
  ApplyRelationshipSuppressionInput,
  RelationshipCommunicationSafetyEvaluation,
  RelationshipSuppression,
  RelationshipSuppressionFilters,
  RelationshipSuppressionPage,
  RelationshipUnsubscribeRequest,
  RevalidateRelationshipEnrollmentSafetyInput,
  RevokeRelationshipSuppressionInput,
} from '@/domain/relationships/safety-contracts';
import type { RelationshipImportPreviewResult, RelationshipImportResolution } from '@/domain/relationships/import-contracts';
import type {
  RelationshipAffiliationInput,
  RelationshipAffiliationKey,
  RelationshipAffiliationRecord,
  RelationshipAffiliationUpdate,
  RelationshipContactFilters,
  RelationshipContactInput,
  RelationshipContactPage,
  RelationshipContactRecord,
  RelationshipOrganizationFilters,
  RelationshipOrganizationInput,
  RelationshipOrganizationPage,
  RelationshipOrganizationRecord,
} from '@/domain/relationships/records';

export type RelationshipSubject = {
  campaignId?: string;
  organizationId?: string;
  contactId?: string;
  opportunityId?: string;
  enrollmentId?: string;
};
export type RelationshipSearchQuery = { query: string; kinds?: RelationshipSearchResult['kind'][]; page?: number; pageSize?: number };

/** Dedicated non-clinical repository boundary. */
export interface RelationshipsRepository {
  capabilities(): Promise<CapabilityAvailability[]>;

  listOrganizations(filters: RelationshipOrganizationFilters): Promise<RelationshipOrganizationPage>;
  getOrganization(id: string): Promise<RelationshipOrganizationRecord | null>;
  createOrganization(input: RelationshipOrganizationInput): Promise<RelationshipOrganizationRecord>;
  updateOrganization(id: string, input: Partial<RelationshipOrganizationInput>): Promise<RelationshipOrganizationRecord>;
  listOrganizationRoles(organizationId: string): Promise<OrganizationRole[]>;
  replaceOrganizationRoles(organizationId: string, roles: OrganizationRole[]): Promise<OrganizationRole[]>;
  listOrganizationSocialProfiles(organizationId: string): Promise<SocialProfile[]>;
  replaceOrganizationSocialProfiles(organizationId: string, profiles: SocialProfile[]): Promise<SocialProfile[]>;

  listContacts(filters: RelationshipContactFilters): Promise<RelationshipContactPage>;
  getContact(id: string): Promise<RelationshipContactRecord | null>;
  createContact(input: RelationshipContactInput): Promise<RelationshipContactRecord>;
  updateContact(id: string, input: Partial<RelationshipContactInput>): Promise<RelationshipContactRecord>;
  listAffiliations(subject: { organizationId?: string; contactId?: string }): Promise<RelationshipAffiliationRecord[]>;
  createAffiliation(input: RelationshipAffiliationInput): Promise<RelationshipAffiliationRecord>;
  updateAffiliation(key: Omit<RelationshipAffiliationKey, 'tenantId'>, input: RelationshipAffiliationUpdate): Promise<RelationshipAffiliationRecord>;

  listStageHistory(subject: RelationshipSubject): Promise<RelationshipStageHistory[]>;
  transitionStage(input: { subject: RelationshipSubject; to: RelationshipStage; reason?: string }): Promise<RelationshipStageHistory>;
  listInteractions(subject: RelationshipSubject, filters?: InteractionFilters): Promise<PageResult<RelationshipInteraction>>;
  createInteraction(input: CreateInteractionInput): Promise<RelationshipInteraction>;

  listReferrals(subject: { organizationId?: string; contactId?: string }): Promise<Referral[]>;
  getReferral(id: string): Promise<Referral | null>;
  createReferral(input: CreateReferralInput): Promise<Referral>;
  updateReferral(id: string, input: UpdateReferralInput): Promise<Referral>;
  verifyReferral(id: string, input: VerifyReferralInput): Promise<Referral>;
  revokeReferral(id: string, input: { revokedAt: string; note?: string }): Promise<Referral>;

  listOpportunities(filters: import('@/domain/relationships/contracts').OpportunityFilters): Promise<PageResult<RelationshipOpportunity>>;
  getOpportunity(id: string): Promise<RelationshipOpportunity | null>;
  createOpportunity(input: CreateOpportunityInput): Promise<RelationshipOpportunity>;
  updateOpportunity(id: string, input: UpdateOpportunityInput): Promise<RelationshipOpportunity>;
  transitionOpportunityStatus(id: string, input: { status: RelationshipOpportunity['status']; reason?: string }): Promise<RelationshipOpportunity>;

  getImportPreview(previewId: string): Promise<RelationshipImportPreviewResult>;
  previewImport(input: { csv: string; mapping: import('@/domain/relationships/contracts').ImportColumnMapping; filename?: string; sourceType?: string }): Promise<RelationshipImportPreviewResult>;
  resolveImportConflicts(input: { previewId: string; conflicts: RelationshipImportResolution[]; expectedVersion?: number }): Promise<RelationshipImportPreviewResult>;
  commitImport(input: { previewId: string; expectedVersion?: number; idempotencyKey?: string }): Promise<{ importId: string }>;

  listCampaigns(filters: RelationshipCampaignFilters): Promise<RelationshipCampaignPage>;
  getCampaign(id: string): Promise<RelationshipCampaign | null>;
  createCampaign(input: { definition: RelationshipCampaignDefinitionInput; idempotencyKey?: string }): Promise<RelationshipCampaign>;
  updateCampaign(id: string, input: { definition: RelationshipCampaignDefinitionInput; expectedVersion: number; idempotencyKey?: string }): Promise<RelationshipCampaign>;
  transitionCampaignStatus(id: string, input: RelationshipCampaignTransitionInput): Promise<RelationshipCampaign>;
  getDeliveryReadiness(campaignId: string): Promise<RelationshipDeliveryReadiness>;
  setCampaignExecution(campaignId: string, input: SetRelationshipCampaignExecutionInput): Promise<RelationshipCampaignExecutionResult>;

  evaluateEnrollmentEligibility(campaignId: string, targets: RelationshipEnrollmentTarget[]): Promise<RelationshipEnrollmentEligibility[]>;
  listEnrollments(campaignId: string, filters?: RelationshipEnrollmentFilters): Promise<RelationshipEnrollmentPage>;
  getEnrollment(id: string): Promise<RelationshipCampaignEnrollment | null>;
  enroll(campaignId: string, input: EnrollRelationshipTargetsInput): Promise<RelationshipCampaignEnrollment[]>;
  transitionEnrollmentStatus(id: string, input: TransitionRelationshipEnrollmentInput): Promise<RelationshipCampaignEnrollment>;
  listEnrollmentEvents(id: string): Promise<RelationshipEnrollmentEvent[]>;

  listSuppressions(filters?: RelationshipSuppressionFilters): Promise<RelationshipSuppressionPage>;
  applySuppression(input: ApplyRelationshipSuppressionInput): Promise<RelationshipSuppression>;
  revokeSuppression(id: string, input: RevokeRelationshipSuppressionInput): Promise<RelationshipSuppression>;
  evaluateEnrollmentSafety(id: string): Promise<RelationshipCommunicationSafetyEvaluation>;
  revalidateEnrollmentSafety(id: string, input: RevalidateRelationshipEnrollmentSafetyInput): Promise<RelationshipCampaignEnrollment>;
  processUnsubscribe(input: { token: string }): Promise<RelationshipUnsubscribeRequest>;

  listCommunications(subject: RelationshipSubject): Promise<RelationshipCommunication[]>;
  listCommunicationEvents(communicationId: string): Promise<RelationshipCommunicationEvent[]>;
  listReplies(filters?: RelationshipReplyFilters): Promise<RelationshipReplyPage>;
  updateReply(id: string, input: UpdateRelationshipReplyInput): Promise<RelationshipReply>;
  listReportMetrics(input?: { period?: { from?: string; to?: string } }): Promise<RelationshipReportMetric[]>;
  search(input: RelationshipSearchQuery): Promise<PageResult<RelationshipSearchResult>>;
}

export class RelationshipCapabilityUnavailableError extends Error {
  readonly capability: Capability;
  constructor(capability: Capability) {
    super(`Relationship capability pending: ${capability}`);
    this.name = 'RelationshipCapabilityUnavailableError';
    this.capability = capability;
  }
}
