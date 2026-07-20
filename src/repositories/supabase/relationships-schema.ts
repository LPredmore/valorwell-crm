import type { Database } from '../../integrations/supabase/types';

type PublicTables = Database['public']['Tables'];

/**
 * Relationship-domain tables that currently exist in the canonical Billing Hub
 * Supabase project. Keeping this list constrained by Database means a renamed or
 * removed generated table fails TypeScript instead of drifting silently.
 */
export const RELATIONSHIP_TABLES = {
  organizations: 'relationship_organizations',
  contacts: 'relationship_contacts',
  contactOrganizations: 'relationship_contact_organizations',
  roleCatalog: 'relationship_role_catalog',
  contactRoles: 'relationship_contact_roles',
  organizationRoles: 'relationship_organization_roles',
  socialProfiles: 'relationship_social_profiles',
  influencerProfiles: 'relationship_influencer_profiles',
} as const satisfies Record<string, keyof PublicTables>;

export type RelationshipTableName =
  (typeof RELATIONSHIP_TABLES)[keyof typeof RELATIONSHIP_TABLES];

type RelationshipTableDefinition<TTable extends RelationshipTableName> =
  PublicTables[TTable];

export type RelationshipRow<TTable extends RelationshipTableName> =
  RelationshipTableDefinition<TTable> extends { Row: infer TRow }
    ? TRow
    : never;

export type RelationshipInsert<TTable extends RelationshipTableName> =
  RelationshipTableDefinition<TTable> extends { Insert: infer TInsert }
    ? TInsert
    : never;

export type RelationshipUpdate<TTable extends RelationshipTableName> =
  RelationshipTableDefinition<TTable> extends { Update: infer TUpdate }
    ? TUpdate
    : never;

export type RelationshipOrganizationRow =
  RelationshipRow<'relationship_organizations'>;
export type RelationshipOrganizationInsert =
  RelationshipInsert<'relationship_organizations'>;
export type RelationshipOrganizationUpdate =
  RelationshipUpdate<'relationship_organizations'>;

export type RelationshipContactRow =
  RelationshipRow<'relationship_contacts'>;
export type RelationshipContactInsert =
  RelationshipInsert<'relationship_contacts'>;
export type RelationshipContactUpdate =
  RelationshipUpdate<'relationship_contacts'>;

export type RelationshipAffiliationRow =
  RelationshipRow<'relationship_contact_organizations'>;
export type RelationshipAffiliationInsert =
  RelationshipInsert<'relationship_contact_organizations'>;
export type RelationshipAffiliationUpdate =
  RelationshipUpdate<'relationship_contact_organizations'>;

/**
 * The affiliation table intentionally has no synthetic id. Its canonical
 * identity is the tenant/contact/organization composite primary key.
 */
export type RelationshipAffiliationKey = Pick<
  RelationshipAffiliationRow,
  'tenant_id' | 'contact_id' | 'organization_id'
>;

export type RelationshipRoleCatalogRow =
  RelationshipRow<'relationship_role_catalog'>;
export type RelationshipRoleCatalogInsert =
  RelationshipInsert<'relationship_role_catalog'>;
export type RelationshipRoleCatalogUpdate =
  RelationshipUpdate<'relationship_role_catalog'>;

export type RelationshipContactRoleRow =
  RelationshipRow<'relationship_contact_roles'>;
export type RelationshipContactRoleInsert =
  RelationshipInsert<'relationship_contact_roles'>;
export type RelationshipContactRoleUpdate =
  RelationshipUpdate<'relationship_contact_roles'>;

export type RelationshipOrganizationRoleRow =
  RelationshipRow<'relationship_organization_roles'>;
export type RelationshipOrganizationRoleInsert =
  RelationshipInsert<'relationship_organization_roles'>;
export type RelationshipOrganizationRoleUpdate =
  RelationshipUpdate<'relationship_organization_roles'>;

export type RelationshipSocialProfileRow =
  RelationshipRow<'relationship_social_profiles'>;
export type RelationshipSocialProfileInsert =
  RelationshipInsert<'relationship_social_profiles'>;
export type RelationshipSocialProfileUpdate =
  RelationshipUpdate<'relationship_social_profiles'>;

export type RelationshipInfluencerProfileRow =
  RelationshipRow<'relationship_influencer_profiles'>;
export type RelationshipInfluencerProfileInsert =
  RelationshipInsert<'relationship_influencer_profiles'>;
export type RelationshipInfluencerProfileUpdate =
  RelationshipUpdate<'relationship_influencer_profiles'>;
