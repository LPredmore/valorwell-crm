import { describe, expect, it } from 'vitest';
import { capabilityState } from '@/domain/relationships/capabilities';
import { planRelationshipUnsubscribe, relationshipUnsubscribeTokenId } from '@/services/relationships/unsubscribe';

const token = 'opaque-public-token-value-12345';

describe('relationship unsubscribe planning', () => {
  it('uses opaque token IDs and does not expose the public token', () => {
    const tokenId = relationshipUnsubscribeTokenId(token);
    expect(tokenId).toMatch(/^relationship-unsubscribe-/);
    expect(tokenId).not.toContain(token);
  });

  it('keeps processing inert while the typed relationship capability is pending', () => {
    const plan = planRelationshipUnsubscribe({ token, capability: capabilityState('unsubscribe') });
    expect(plan).toMatchObject({ outcome: 'pending', idempotent: true });
    expect(plan.message).toContain('No preferences were changed');
  });

  it('is idempotent for an already-processed relationship unsubscribe', () => {
    const plan = planRelationshipUnsubscribe({ token, capability: capabilityState('unsubscribe', 'available'), existingOutcome: 'unsubscribed' });
    expect(plan).toMatchObject({ outcome: 'already_unsubscribed', idempotent: true });
  });

  it('rejects malformed public tokens without querying any preference store', () => {
    expect(planRelationshipUnsubscribe({ token: 'short' })).toMatchObject({ outcome: 'invalid_token', idempotent: true });
  });
});
