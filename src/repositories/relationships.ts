import type {
  Capability,
  CapabilityAvailability,
  CreateInteractionInput,
  CreateOpportunityInput,
  CreateReferralInput,
  CreateSuppressionInput,
  InteractionFilters,
  OrganizationRole,
  PageResult,
  RelationshipCommunicationLog,
  RelationshipEnrollment,
  RelationshipInteraction,
  RelationshipOpportunity,
  RelationshipReply,
  RelationshipReportMetric,
  RelationshipSearchResult,
  RelationshipStage,
  RelationshipStageHistory,
  RelationshipSuppression,
  RelationshipUnsubscribeRequest,
  Referral,
  SocialProfile,
  SuppressionFilters,
  UpdateOpportunityInput,
  UpdateReferralInput,
  UpdateSuppressionInput,
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
  RelationshipImportPreviewResult,
  RelationshipImportResolution,
} from '@/domain/relationships/import-contracts';
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

export type RelationshipSubject = { organizationId?: string; contactId?: string; opportunityId?: string };
export type RelationshipEnrollmentTarget = { organizationId?: string; contactId?: string; opportunityId?: string };
export type RelationshipSearchQuery = { query: string; kinds?: RelationshipSearchResult['kind'][]; page?: number; pageSize?: number };

/**
 * Dedicated non-clinical repository boundary. It intentionally has no client,
 * clinical campaign, client-note, clinical activity, or clinical
 * communication-policy methods.
 */
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
  updateAffiliation(
    key: Omit<RelationshipAffiliationKey, 'tenantId'>,
    input: RelationshipAffiliationUpdate,
  ): Promise<RelationshipAffiliationRecord>;

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
  previewImport(input: {
    csv: string;
    mapping: import('@/domain/relationships/contracts').ImportColumnMapping;
    filename?: string;
    sourceType?: string;
  }): Promise<RelationshipImportPreviewResult>;
  resolveImportConflicts(input: {
    previewId: string;
    conflicts: RelationshipImportResolution[];
    expectedVersion?: number;
  }): Promise<RelationshipImportPreviewResult>;
  commitImport(input: {
    previewId: string;
    expectedVersion?: number;
    idempotencyKey?: string;
  }): Promise<{ importId: string }>;

  listCampaigns(filters: RelationshipCampaignFilters): Promise<RelationshipCampaignPage>;
  getCampaign(id: string): Promise<RelationshipCampaign | null>;
  createCampaign(input: {
    definition: RelationshipCampaignDefinitionInput;
    idempotencyKey?: string;
  }): Promise<RelationshipCampaign>;
  updateCampaign(id: string, input: {
    definition: RelationshipCampaignDefinitionInput;
    expectedVersion: number;
    idempotencyKey?: string;
  }): Promise<RelationshipCampaign>;
  transitionCampaignStatus(id: string, input: RelationshipCampaignTransitionInput): Promise<RelationshipCampaign>;

  listEnrollments(campaignId: string): Promise<RelationshipEnrollment[]>;
  enroll(campaignId: string, targets: RelationshipEnrollmentTarget[]): Promise<RelationshipEnrollment[]>;
  updateEnrollmentStatus(id: string, input: { status: RelationshipEnrollment['status']; reason?: string }): Promise<RelationshipEnrollment>;
  listCommunications(subject: RelationshipSubject): Promise<RelationshipCommunicationLog[]>;
  listReplies(filters?: { status?: RelationshipReply['status'][]; ownerId?: string }): Promise<RelationshipReply[]>;
  updateReply(id: string, input: { status?: RelationshipReply['status']; ownerId?: string; followUpDueAt?: string }): Promise<RelationshipReply>;

  listSuppressions(filters?: SuppressionFilters): Promise<PageResult<RelationshipSuppression>>;
  createSuppression(input: CreateSuppressionInput): Promise<RelationshipSuppression>;
  updateSuppression(id: string, input: UpdateSuppressionInput): Promise<RelationshipSuppression>;
  processUnsubscribe(input: { token: string }): Promise<RelationshipUnsubscribeRequest>;

  listReportMetrics(input?: { period?: { from?: string; to?: string } }): Promise<RelationshipReportMetric[]>;
  search(input: RelationshipSearchQuery): Promise<PageResult<RelationshipSearchResult>>;
}

export class RelationshipCapabilityUnavailableError extends Error {
  readonly capability: Capability;
  constructor(capability: Capability) { super(`Relationship capability pending: ${capability}`); this.name = 'RelationshipCapabilityUnavailableError'; this.capability = capability; }
}
