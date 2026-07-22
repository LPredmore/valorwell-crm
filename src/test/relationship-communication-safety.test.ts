import { describe, expect, it } from 'vitest';
import type { Json } from '@/integrations/supabase/types';
import { mapRelationshipEnrollmentResponse, mapRelationshipSafetyEvaluation } from '@/repositories/supabase/relationships-enrollment-mappers';
import { relationshipSuppressionReasons, relationshipSuppressionScopes } from '@/domain/relationships/safety-contracts';

const safety = {
  eligible: false,
  safetyEligible: false,
  safetyStatus: 'blocked',
  deliveryEnabled: false,
  reasons: ['suppressed'],
  suppressions: [{
    id: 'suppression-1',
    scope: 'global',
    reason: 'complaint',
    effectiveAt: '2026-07-22T12:00:00Z',
  }],
  primarySuppression: {
    id: 'suppression-1',
    scope: 'global',
    reason: 'complaint',
    effectiveAt: '2026-07-22T12:00:00Z',
  },
  policyVersion: 'pass11-v1',
  evaluatedAt: '2026-07-22T12:00:00Z',
  campaignId: 'campaign-1',
  contactId: 'contact-1',
  recipientEmail: 'person@example.org',
  sourceLanguageMode: 'none',
} as unknown as Json;

describe('relationship communication safety', () => {
  it('keeps the complete suppression scope and reason taxonomy explicit', () => {
    expect(relationshipSuppressionScopes).toEqual(['global', 'organization', 'contact', 'email', 'campaign']);
    expect(relationshipSuppressionReasons).toContain('unsubscribe');
    expect(relationshipSuppressionReasons).toContain('complaint');
    expect(relationshipSuppressionReasons).toContain('campaign_stop');
  });

  it('maps deterministic precedence evidence without enabling delivery', () => {
    const result = mapRelationshipSafetyEvaluation(safety);
    expect(result.eligible).toBe(false);
    expect(result.primarySuppression).toMatchObject({ scope: 'global', reason: 'complaint' });
    expect(result.policyVersion).toBe('pass11-v1');
    expect(result.deliveryEnabled).toBe(false);
  });

  it('maps a safety-blocked enrollment and preserves delivery off', () => {
    const enrollment = mapRelationshipEnrollmentResponse({
      id: 'enrollment-1',
      campaignId: 'campaign-1',
      contactId: 'contact-1',
      recipientEmail: 'person@example.org',
      status: 'suppressed',
      sourceLanguageMode: 'none',
      personalizationContext: {},
      eligibilitySnapshot: {
        target: { contactId: 'contact-1' },
        eligible: true,
        reasons: [],
        resolvedContactId: 'contact-1',
        recipientEmail: 'person@example.org',
        sourceLanguageMode: 'none',
        personalizationContext: {},
      },
      safetyStatus: 'blocked',
      safetySnapshot: safety,
      safetyEvaluatedAt: '2026-07-22T12:00:00Z',
      safetyBlockedAt: '2026-07-22T12:00:00Z',
      deliveryEnabled: false,
      version: 2,
      createdAt: '2026-07-22T11:00:00Z',
      updatedAt: '2026-07-22T12:00:00Z',
    } as unknown as Json);

    expect(enrollment.status).toBe('suppressed');
    expect(enrollment.safetyStatus).toBe('blocked');
    expect(enrollment.safetySnapshot?.primarySuppression?.scope).toBe('global');
    expect(enrollment.deliveryEnabled).toBe(false);
  });
});
