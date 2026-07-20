import type {
  CampaignEligibilityReason,
  CampaignEligibilityResult,
  CapabilityAvailability,
  OpportunityStatus,
  SourceLanguageMode,
} from '@/domain/relationships/contracts';

export type RelationshipEnrollmentEligibilityInput = {
  email?: string;
  reviewStatus?: string;
  opportunityStatus?: OpportunityStatus;
  doNotContact?: boolean;
  suppressed?: boolean;
  hasActiveEnrollment?: boolean;
  hasPreviousResponse?: boolean;
  sourceLanguage: SourceLanguageMode;
  allowedSourceLanguages?: SourceLanguageMode[];
  enrollmentCapability?: CapabilityAvailability;
  requireApprovedReview?: boolean;
  requiredOpportunityStatuses?: OpportunityStatus[];
};

export type RelationshipEnrollmentEligibility = CampaignEligibilityResult & {
  explanations: string[];
};

const explanationByReason: Record<CampaignEligibilityReason, string> = {
  missing_email: 'A deliverable email address is required before a relationship contact can be selected.',
  review_not_approved: 'This target must complete relationship review before enrollment.',
  opportunity_not_qualified: 'This target does not meet the campaign qualification requirement.',
  do_not_contact: 'The relationship record is marked do not contact.',
  suppressed: 'An active relationship suppression prevents enrollment.',
  active_enrollment: 'This target is already enrolled in an active relationship campaign.',
  previous_response: 'A prior response requires a staff review before additional outreach.',
  source_language_not_allowed: 'The campaign does not permit the available relationship source language.',
  campaign_requirement_not_met: 'A campaign-specific requirement is not met.',
  capability_pending: 'Enrollment remains disabled until the typed relationship enrollment capability is available.',
};

function hasDeliverableEmail(email?: string) {
  return Boolean(email?.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()));
}

/**
 * Evaluates a relationship target without querying or writing clinical data.
 * The caller supplies the already-scoped relationship facts, and enrollment is
 * never eligible while the typed enrollment capability is unavailable.
 */
export function evaluateRelationshipEnrollmentEligibility(
  input: RelationshipEnrollmentEligibilityInput,
): RelationshipEnrollmentEligibility {
  const reasons: CampaignEligibilityReason[] = [];
  const reviewRequired = input.requireApprovedReview ?? true;
  const allowedSourceLanguages = input.allowedSourceLanguages ?? [
    'research',
    'community',
    'verified_anonymous',
    'verified_named',
  ];

  if (!hasDeliverableEmail(input.email)) reasons.push('missing_email');
  if (reviewRequired && input.reviewStatus !== 'approved') reasons.push('review_not_approved');
  if (input.requiredOpportunityStatuses?.length && !input.opportunityStatus) reasons.push('campaign_requirement_not_met');
  else if (input.requiredOpportunityStatuses?.length && !input.requiredOpportunityStatuses.includes(input.opportunityStatus)) reasons.push('opportunity_not_qualified');
  if (input.doNotContact) reasons.push('do_not_contact');
  if (input.suppressed) reasons.push('suppressed');
  if (input.hasActiveEnrollment) reasons.push('active_enrollment');
  if (input.hasPreviousResponse) reasons.push('previous_response');
  if (!allowedSourceLanguages.includes(input.sourceLanguage)) reasons.push('source_language_not_allowed');
  if (input.enrollmentCapability?.available !== true) reasons.push('capability_pending');

  return {
    eligible: reasons.length === 0,
    reasons,
    sourceLanguage: input.sourceLanguage,
    explanations: reasons.map((reason) => explanationByReason[reason]),
  };
}

export function enrollmentEligibilityExplanation(reason: CampaignEligibilityReason) {
  return explanationByReason[reason];
}
