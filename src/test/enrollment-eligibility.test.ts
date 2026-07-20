import { describe, expect, it } from 'vitest';
import { capabilityState } from '@/domain/relationships/capabilities';
import { evaluateRelationshipEnrollmentEligibility } from '@/services/relationships/enrollment-eligibility';

const eligibleTarget = {
  email: 'partner@example.org',
  reviewStatus: 'approved',
  opportunityStatus: 'qualified' as const,
  sourceLanguage: 'research' as const,
  enrollmentCapability: capabilityState('enrollment', 'available'),
};

describe('relationship enrollment eligibility', () => {
  it('allows a fully qualified relationship target when the enrollment capability is available', () => {
    expect(evaluateRelationshipEnrollmentEligibility(eligibleTarget)).toMatchObject({ eligible: true, reasons: [] });
  });

  it('explains relationship-only target blockers without any enrollment write', () => {
    const result = evaluateRelationshipEnrollmentEligibility({
      ...eligibleTarget,
      email: 'invalid address',
      reviewStatus: 'pending',
      requiredOpportunityStatuses: ['ready_for_campaign'],
      doNotContact: true,
      suppressed: true,
      hasActiveEnrollment: true,
      hasPreviousResponse: true,
      sourceLanguage: 'none',
      allowedSourceLanguages: ['research'],
    });

    expect(result.eligible).toBe(false);
    expect(result.reasons).toEqual([
      'missing_email', 'review_not_approved', 'opportunity_not_qualified',
      'do_not_contact', 'suppressed', 'active_enrollment', 'previous_response', 'source_language_not_allowed',
    ]);
    expect(result.explanations).toHaveLength(result.reasons.length);
  });

  it('keeps enrollment disabled while the typed relationship capability is pending', () => {
    const result = evaluateRelationshipEnrollmentEligibility({ ...eligibleTarget, enrollmentCapability: capabilityState('enrollment') });
    expect(result).toMatchObject({ eligible: false, reasons: ['capability_pending'] });
    expect(result.explanations[0]).toContain('typed relationship enrollment capability');
  });

  it('requires a source language that the campaign explicitly permits', () => {
    const result = evaluateRelationshipEnrollmentEligibility({ ...eligibleTarget, sourceLanguage: 'verified_named', allowedSourceLanguages: ['research'] });
    expect(result.reasons).toContain('source_language_not_allowed');
  });
});
