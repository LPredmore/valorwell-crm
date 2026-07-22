import { describe, expect, it } from 'vitest';
import { capabilityError, capabilityState, relationshipCapabilities } from '@/domain/relationships/capabilities';
import { unavailableRelationshipsRepository } from '@/repositories/relationships-unavailable';
import { RelationshipCapabilityUnavailableError, type RelationshipsRepository } from '@/repositories/relationships';

// Compile-time boundary: relationship enrollments accept relationship targets,
// not clinical-client IDs or the clinical campaign-enrollment pathway.
function assertNoClinicalEnrollmentPath(repository: RelationshipsRepository) {
  repository.enroll('relationship-campaign', {
    // @ts-expect-error A clinical client ID is not a relationship enrollment target.
    targets: ['clinical-client-id'],
    expectedCampaignVersion: 1,
  });
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
    await expect(unavailableRelationshipsRepository.createContact({ email: 'no-write@example.test' }))
      .rejects.toMatchObject({ capability: 'contacts' });
  });

  it('uses a composite affiliation key rather than a synthetic affiliation ID', async () => {
    await expect(unavailableRelationshipsRepository.updateAffiliation(
      { contactId: 'contact-1', organizationId: 'org-1' },
      { isPrimary: true },
    )).rejects.toMatchObject({ capability: 'contacts' });
  });

  it('exposes relationship-only campaign, reply, suppression, reporting, and search operations', async () => {
    expect(Object.keys(unavailableRelationshipsRepository)).toEqual(expect.arrayContaining([
      'listCampaigns', 'enroll', 'listReplies', 'listSuppressions',
      'processUnsubscribe', 'listReportMetrics', 'search',
    ]));
    await expect(unavailableRelationshipsRepository.enroll('campaign-1', {
      targets: [{ organizationId: 'org-1' }],
      expectedCampaignVersion: 1,
    })).rejects.toMatchObject({ capability: 'enrollment' });
    await expect(unavailableRelationshipsRepository.processUnsubscribe({ token: 'opaque-token' }))
      .rejects.toMatchObject({ capability: 'unsubscribe' });
  });
});
