import { describe, expect, it } from 'vitest';
import { capabilityError, capabilityState, relationshipCapabilities } from '@/domain/relationships/capabilities';
import { unavailableRelationshipsRepository } from '@/repositories/relationships-unavailable';
import { RelationshipCapabilityUnavailableError, type RelationshipsRepository } from '@/repositories/relationships';

// Compile-time boundary: relationship enrollments accept relationship targets,
// not clinical-client IDs or the clinical campaign-enrollment pathway.
function assertNoClinicalEnrollmentPath(repository: RelationshipsRepository) {
  // @ts-expect-error A clinical client ID is not a relationship enrollment target.
  repository.enroll('relationship-campaign', ['clinical-client-id']);
}
void assertNoClinicalEnrollmentPath;

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

  it('exposes relationship-only campaign, reply, suppression, reporting, and search operations', async () => {
    expect(Object.keys(unavailableRelationshipsRepository)).toEqual(expect.arrayContaining([
      'listCampaigns', 'enroll', 'listReplies', 'listSuppressions',
      'processUnsubscribe', 'listReportMetrics', 'search',
    ]));
    await expect(unavailableRelationshipsRepository.enroll('campaign-1', [{ organizationId: 'org-1' }]))
      .rejects.toMatchObject({ capability: 'enrollment' });
    await expect(unavailableRelationshipsRepository.processUnsubscribe({ token: 'opaque-token' }))
      .rejects.toMatchObject({ capability: 'unsubscribe' });
  });
});
