import type {
  CampaignFilters,
  Capability,
  CapabilityAvailability,
  CreateCampaignInput,
  CreateInteractionInput,
  CreateOpportunityInput,
  CreateReferralInput,
  CreateSuppressionInput,
  ImportConflict,
  ImportPreviewResult,
  InteractionFilters,
  OrganizationRole,
  PageResult,
  RelationshipCampaign,
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
  UpdateCampaignInput,
  UpdateOpportunityInput,
  UpdateReferralInput,
  UpdateSuppressionInput,
  VerifyReferralInput,
} from '@/domain/relationships/contracts';
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

  previewImport(input: { csv: string; mapping: import('@/domain/relationships/contracts').ImportColumnMapping }): Promise<ImportPreviewResult>;
  resolveImportConflicts(input: { previewId: string; conflicts: ImportConflict[] }): Promise<ImportPreviewResult>;
  commitImport(input: { previewId: string }): Promise<{ importId: string }>;

  listCampaigns(filters: CampaignFilters): Promise<PageResult<RelationshipCampaign>>;
  getCampaign(id: string): Promise<RelationshipCampaign | null>;
  createCampaign(input: CreateCampaignInput): Promise<RelationshipCampaign>;
  updateCampaign(id: string, input: UpdateCampaignInput): Promise<RelationshipCampaign>;
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
