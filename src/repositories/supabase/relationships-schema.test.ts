import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  RELATIONSHIP_TABLES,
  type RelationshipAffiliationInsert,
  type RelationshipAffiliationKey,
  type RelationshipAffiliationRow,
  type RelationshipContactInsert,
  type RelationshipOrganizationInsert,
} from './relationships-schema';

type HasKey<TValue, TKey extends PropertyKey> = TKey extends keyof TValue
  ? true
  : false;

describe('canonical relationship persistence schema', () => {
  it('tracks every relationship table in the generated Supabase schema', () => {
    expect(Object.values(RELATIONSHIP_TABLES)).toEqual([
      'relationship_organizations',
      'relationship_contacts',
      'relationship_contact_organizations',
      'relationship_role_catalog',
      'relationship_contact_roles',
      'relationship_organization_roles',
      'relationship_social_profiles',
      'relationship_influencer_profiles',
    ]);
  });

  it('requires the canonical tenant boundary on first-slice inserts', () => {
    expectTypeOf<RelationshipOrganizationInsert>().toMatchTypeOf<{
      tenant_id: string;
      name: string;
    }>();

    expectTypeOf<RelationshipContactInsert>().toMatchTypeOf<{
      tenant_id: string;
      first_name: string;
      last_name: string;
    }>();

    expectTypeOf<RelationshipAffiliationInsert>().toMatchTypeOf<{
      tenant_id: string;
      contact_id: string;
      organization_id: string;
    }>();
  });

  it('uses the database composite key for affiliations', () => {
    const key: RelationshipAffiliationKey = {
      tenant_id: 'tenant-id',
      contact_id: 'contact-id',
      organization_id: 'organization-id',
    };

    const affiliationHasSyntheticId: HasKey<RelationshipAffiliationRow, 'id'> =
      false;

    expect(key).toEqual({
      tenant_id: 'tenant-id',
      contact_id: 'contact-id',
      organization_id: 'organization-id',
    });
    expect(affiliationHasSyntheticId).toBe(false);
  });
});
