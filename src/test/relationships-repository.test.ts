import { describe, expect, it } from 'vitest';
import { capabilityError, capabilityState, relationshipCapabilities } from '@/domain/relationships/capabilities';
import { unavailableRelationshipsRepository } from '@/repositories/relationships-unavailable';
import { RelationshipCapabilityUnavailableError } from '@/repositories/relationships';

describe('relationship repository boundary', () => {
  it('reports distinct capability failures without pretending they are available', () => {
    expect(capabilityState('organizations', 'permission_denied').available).toBe(false);
    expect(capabilityState('organizations', 'network_error').status).toBe('network_error');
    expect(capabilityError('organizations', 'permission_denied').code).toBe('permission_denied');
    expect(relationshipCapabilities({ organizations: 'available' }).find(item => item.capability === 'organizations')?.available).toBe(true);
  });

  it('does not query or substitute a clinical repository when support is absent', async () => {
    await expect(unavailableRelationshipsRepository.listOrganizations({})).rejects.toBeInstanceOf(RelationshipCapabilityUnavailableError);
    await expect(unavailableRelationshipsRepository.createContact({ kind: 'person', displayName: 'No write', organizationIds: [], stage: 'identified', doNotContact: false })).rejects.toMatchObject({ capability: 'contacts' });
  });
});
