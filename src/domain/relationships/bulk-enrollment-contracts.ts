import type { PageResult, SourceLanguageMode } from './contracts';
import type { RelationshipEnrollmentTarget } from './enrollment-contracts';

export const relationshipBulkAudienceKinds = ['donor', 'bty_referral'] as const;
export type RelationshipBulkAudienceKind = (typeof relationshipBulkAudienceKinds)[number];

export type RelationshipCampaignCandidate = {
  contactId: string;
  contactName: string;
  email: string;
  organizationId?: string;
  organizationName?: string;
  audienceKinds: RelationshipBulkAudienceKind[];
  roleCodes: string[];
  sourceLanguageMode: SourceLanguageMode;
  verifiedReferralId?: string;
  referralCategory?: string;
  referralDisclosure?: string;
  doNotContact: boolean;
  organizationDoNotContact: boolean;
};

export type RelationshipCampaignCandidateFilters = {
  audiences?: RelationshipBulkAudienceKind[];
  search?: string;
  page?: number;
  pageSize?: number;
};

export type RelationshipCampaignCandidatePage = PageResult<RelationshipCampaignCandidate>;

export function relationshipCandidateTarget(candidate: RelationshipCampaignCandidate): RelationshipEnrollmentTarget {
  const verified = candidate.sourceLanguageMode === 'verified_anonymous'
    || candidate.sourceLanguageMode === 'verified_named';
  return {
    contactId: candidate.contactId,
    organizationId: candidate.organizationId,
    sourceLanguageMode: candidate.sourceLanguageMode,
    verifiedReferralId: verified ? candidate.verifiedReferralId : undefined,
  };
}

export function relationshipTargetBatches<T>(items: T[], size = 100) {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}
