import type { AuditMetadata, PageResult } from './contracts';

export const relationshipSuppressionScopes = ['global', 'organization', 'contact', 'email', 'campaign'] as const;
export type RelationshipSuppressionScope = (typeof relationshipSuppressionScopes)[number];

export const relationshipSuppressionReasons = [
  'manual',
  'unsubscribe',
  'do_not_contact',
  'invalid_address',
  'bounce',
  'complaint',
  'campaign_stop',
] as const;
export type RelationshipSuppressionReason = (typeof relationshipSuppressionReasons)[number];

export type RelationshipSuppression = AuditMetadata & {
  id: string;
  scope: RelationshipSuppressionScope;
  reason: RelationshipSuppressionReason;
  organizationId?: string;
  contactId?: string;
  campaignId?: string;
  email?: string;
  effectiveAt: string;
  expiresAt?: string;
  revokedAt?: string;
  revokedBy?: string;
  version: number;
  source: string;
  metadata: Record<string, unknown>;
};

export type RelationshipSuppressionFilters = {
  scopes?: RelationshipSuppressionScope[];
  reasons?: RelationshipSuppressionReason[];
  activeOnly?: boolean;
  organizationId?: string;
  contactId?: string;
  campaignId?: string;
  email?: string;
  page?: number;
  pageSize?: number;
};

export type RelationshipSuppressionPage = PageResult<RelationshipSuppression>;

export type ApplyRelationshipSuppressionInput = {
  scope: RelationshipSuppressionScope;
  reason: RelationshipSuppressionReason;
  organizationId?: string;
  contactId?: string;
  campaignId?: string;
  email?: string;
  effectiveAt?: string;
  expiresAt?: string;
  source?: string;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
};

export type RevokeRelationshipSuppressionInput = {
  expectedVersion: number;
  reason?: string;
  idempotencyKey?: string;
};

export type RelationshipSafetySuppressionMatch = {
  id: string;
  scope: RelationshipSuppressionScope;
  reason: RelationshipSuppressionReason;
  organizationId?: string;
  contactId?: string;
  campaignId?: string;
  email?: string;
  effectiveAt: string;
  expiresAt?: string;
};

export type RelationshipCommunicationSafetyEvaluation = {
  eligible: boolean;
  safetyEligible: boolean;
  safetyStatus: 'ready' | 'blocked';
  deliveryEnabled: false;
  reasons: string[];
  suppressions: RelationshipSafetySuppressionMatch[];
  primarySuppression?: RelationshipSafetySuppressionMatch;
  policyVersion: 'pass11-v1';
  evaluatedAt: string;
  campaignId: string;
  contactId: string;
  organizationId?: string;
  opportunityId?: string;
  recipientEmail: string;
  sourceLanguageMode: string;
};

export type RevalidateRelationshipEnrollmentSafetyInput = {
  expectedVersion: number;
  reason?: string;
  idempotencyKey?: string;
};

export type RelationshipUnsubscribeOutcome = 'pending' | 'unsubscribed' | 'already_unsubscribed' | 'invalid_token';

export type RelationshipUnsubscribeRequest = {
  id: string;
  tokenId?: string;
  email?: string;
  processedAt?: string;
  suppressionId?: string;
  outcome: RelationshipUnsubscribeOutcome;
  createdAt: string;
  updatedAt: string;
};
