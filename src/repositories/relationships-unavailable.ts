import { capabilityError, relationshipCapabilities } from '@/domain/relationships/capabilities';
import type { ContactInput, ContactQuery, ImportPreview, Organization, OrganizationInput, OrganizationQuery, PageResult, RelationshipContact, RelationshipInteraction, RelationshipOpportunity, Referral } from '@/domain/relationships/contracts';
import { RelationshipCapabilityUnavailableError, type RelationshipsRepository } from './relationships';

const unavailable = (capability: Parameters<typeof capabilityError>[0]): never => { throw new RelationshipCapabilityUnavailableError(capability); };
/** Safe production adapter until a typed relationship schema adapter is installed. */
export const unavailableRelationshipsRepository: RelationshipsRepository = {
  async capabilities() { return relationshipCapabilities(); },
  async listOrganizations(_query: OrganizationQuery): Promise<PageResult<Organization>> { return unavailable('organizations'); },
  async getOrganization(_id: string): Promise<Organization | null> { return unavailable('organizations'); },
  async createOrganization(_input: OrganizationInput): Promise<Organization> { return unavailable('organizations'); },
  async updateOrganization(_id: string, _input: Partial<OrganizationInput>): Promise<Organization> { return unavailable('organizations'); },
  async listContacts(_query: ContactQuery): Promise<PageResult<RelationshipContact>> { return unavailable('contacts'); },
  async getContact(_id: string): Promise<RelationshipContact | null> { return unavailable('contacts'); },
  async createContact(_input: ContactInput): Promise<RelationshipContact> { return unavailable('contacts'); },
  async updateContact(_id: string, _input: Partial<ContactInput>): Promise<RelationshipContact> { return unavailable('contacts'); },
  async listInteractions(_subject): Promise<RelationshipInteraction[]> { return unavailable('interactions'); },
  async listReferrals(_subject): Promise<Referral[]> { return unavailable('referrals'); },
  async listOpportunities(_query): Promise<RelationshipOpportunity[]> { return unavailable('opportunities'); },
  async previewImport(_input): Promise<ImportPreview> { return unavailable('imports'); },
};
