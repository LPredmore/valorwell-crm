import { describe, expect, it } from 'vitest';
import type { Json } from '@/integrations/supabase/types';
import { operatorEnrollmentTransitions } from '@/domain/relationships/enrollment-contracts';
import {
  mapRelationshipEnrollmentEligibility,
  mapRelationshipEnrollmentResponse,
} from '@/repositories/supabase/relationships-enrollment-mappers';

describe('relationship campaign enrollment orchestration', () => {
  it('keeps Pass 10 operator transitions away from delivery and terminal system states', () => {
    expect(operatorEnrollmentTransitions('pending')).toEqual(['paused', 'stopped']);
    expect(operatorEnrollmentTransitions('active')).toEqual(['paused', 'stopped']);
    expect(operatorEnrollmentTransitions('paused')).toEqual(['pending', 'stopped']);
    expect(operatorEnrollmentTransitions('responded')).toEqual([]);
    expect(operatorEnrollmentTransitions('completed')).toEqual([]);
    expect(operatorEnrollmentTransitions('suppressed')).toEqual([]);
  });

  it('maps eligibility as preliminary while safety and delivery remain locked', () => {
    const eligibility = mapRelationshipEnrollmentEligibility({
      target: {
        contactId: 'contact-1',
        sourceLanguageMode: 'verified_anonymous',
        verifiedReferralId: 'referral-1',
      },
      eligible: true,
      reasons: [],
      resolvedContactId: 'contact-1',
      verifiedReferralId: 'referral-1',
      recipientEmail: 'person@example.org',
      recipientName: 'Person',
      sourceLanguageMode: 'verified_anonymous',
      personalizationContext: { contactDisplayName: 'Person' },
      safetyStatus: 'ready',
      safetyEligible: true,
      deliveryEnabled: true,
      executionEnabled: true,
      executionBoundary: 'enabled',
    } as unknown as Json);

    expect(eligibility.eligible).toBe(true);
    expect(eligibility.resolvedContactId).toBe('contact-1');
    expect(eligibility.target.verifiedReferralId).toBe('referral-1');
    expect(eligibility.verifiedReferralId).toBe('referral-1');
    expect(eligibility.safetyStatus).toBe('pending_pass_11');
    expect(eligibility.safetyEligible).toBe(false);
    expect(eligibility.deliveryEnabled).toBe(false);
    expect(eligibility.executionEnabled).toBe(false);
    expect(eligibility.executionBoundary).toBe('disabled_until_passes_11_12');
  });

  it('requires every mapped enrollment to contain a resolved contact', () => {
    expect(() => mapRelationshipEnrollmentResponse({
      id: 'enrollment-1',
      campaignId: 'campaign-1',
      recipientEmail: 'person@example.org',
      status: 'pending',
      sourceLanguageMode: 'none',
      personalizationContext: {},
      eligibilitySnapshot: {},
      version: 1,
      createdAt: '2026-07-22T00:00:00Z',
      updatedAt: '2026-07-22T00:00:00Z',
    } as unknown as Json)).toThrow('Invalid relationship contact id.');
  });

  it('maps a dormant pending enrollment without inventing delivery state', () => {
    const enrollment = mapRelationshipEnrollmentResponse({
      id: 'enrollment-1',
      campaignId: 'campaign-1',
      contactId: 'contact-1',
      recipientEmail: 'person@example.org',
      recipientName: 'Person',
      status: 'pending',
      currentStepPosition: 1,
      nextScheduledAt: '2026-07-22T14:00:00Z',
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
      safetyStatus: 'pending_pass_11',
      deliveryEnabled: false,
      version: 1,
      createdAt: '2026-07-22T00:00:00Z',
      updatedAt: '2026-07-22T00:00:00Z',
    } as unknown as Json);

    expect(enrollment.contactId).toBe('contact-1');
    expect(enrollment.status).toBe('pending');
    expect(enrollment.currentStepPosition).toBe(1);
    expect(enrollment.safetyStatus).toBe('pending_pass_11');
    expect(enrollment.deliveryEnabled).toBe(false);
  });
});
