import type { Capability, CapabilityAvailability, ContactInput, ContactQuery, ImportPreview, Organization, OrganizationInput, OrganizationQuery, PageResult, RelationshipContact, RelationshipInteraction, RelationshipOpportunity, Referral } from '@/domain/relationships/contracts';

/**
 * Dedicated non-clinical repository boundary.  It intentionally has no client,
 * clinical campaign, client-note, or clinical communication-policy methods.
 */
export interface RelationshipsRepository {
  capabilities(): Promise<CapabilityAvailability[]>;
  listOrganizations(query: OrganizationQuery): Promise<PageResult<Organization>>;
  getOrganization(id: string): Promise<Organization | null>;
  createOrganization(input: OrganizationInput): Promise<Organization>;
  updateOrganization(id: string, input: Partial<OrganizationInput>): Promise<Organization>;
  listContacts(query: ContactQuery): Promise<PageResult<RelationshipContact>>;
  getContact(id: string): Promise<RelationshipContact | null>;
  createContact(input: ContactInput): Promise<RelationshipContact>;
  updateContact(id: string, input: Partial<ContactInput>): Promise<RelationshipContact>;
  listInteractions(subject: { organizationId?: string; contactId?: string; opportunityId?: string }): Promise<RelationshipInteraction[]>;
  listReferrals(subject: { organizationId?: string; contactId?: string }): Promise<Referral[]>;
  listOpportunities(query: { organizationId?: string; contactId?: string }): Promise<RelationshipOpportunity[]>;
  previewImport(input: { csv: string; mapping: Record<string, string> }): Promise<ImportPreview>;
}

export class RelationshipCapabilityUnavailableError extends Error {
  readonly capability: Capability;
  constructor(capability: Capability) { super(`Relationship capability pending: ${capability}`); this.name = 'RelationshipCapabilityUnavailableError'; this.capability = capability; }
}
