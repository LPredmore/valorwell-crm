import { describe, expect, it } from 'vitest';
import { relationshipSuppressionPrecedence, resolveRelationshipSuppression } from '@/services/relationships/suppression';

const audit = { createdAt: '2026-03-01T00:00:00.000Z', updatedAt: '2026-03-01T00:00:00.000Z' };
const now = new Date('2026-03-10T00:00:00.000Z');
const suppression = (id: string, scope: 'global' | 'email' | 'contact' | 'organization' | 'campaign', reason: 'manual' | 'unsubscribe' | 'do_not_contact' | 'invalid_address' | 'bounce' | 'complaint' | 'campaign_stop', extra = {}) => ({ ...audit, id, scope, reason, effectiveAt: audit.createdAt, ...extra });

describe('relationship suppression precedence', () => {
  it('applies only matching active relationship suppressions and uses explicit precedence', () => {
    const result = resolveRelationshipSuppression({ subject: { contactId: 'contact-1', email: 'partner@example.org', campaignId: 'campaign-1' }, now, suppressions: [
      suppression('campaign', 'campaign', 'campaign_stop', { campaignId: 'campaign-1' }),
      suppression('contact', 'contact', 'manual', { contactId: 'contact-1' }),
      suppression('email', 'email', 'unsubscribe', { email: 'partner@example.org' }),
    ] });
    expect(result.effective?.id).toBe('email');
    expect(result.audit.map((entry) => entry.suppressionId)).toEqual(['email', 'contact', 'campaign']);
  });

  it('honors global suppressions and ignores expired or nonmatching entries', () => {
    const result = resolveRelationshipSuppression({ subject: { email: 'partner@example.org' }, now, suppressions: [
      suppression('expired', 'email', 'bounce', { email: 'partner@example.org', expiresAt: '2026-03-02T00:00:00.000Z' }),
      suppression('other', 'email', 'manual', { email: 'other@example.org' }),
      suppression('global', 'global', 'complaint'),
    ] });
    expect(result).toMatchObject({ suppressed: true, effective: { id: 'global' } });
    expect(result.active).toHaveLength(1);
  });

  it('exposes stable precedence for audit and UI ordering', () => {
    expect(relationshipSuppressionPrecedence('global')).toBeGreaterThan(relationshipSuppressionPrecedence('email'));
    expect(relationshipSuppressionPrecedence('email')).toBeGreaterThan(relationshipSuppressionPrecedence('campaign'));
  });
});
