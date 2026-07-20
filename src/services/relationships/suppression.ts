import type { RelationshipSuppression, SuppressionReason, SuppressionScope } from '@/domain/relationships/contracts';

export type RelationshipSuppressionSubject = { organizationId?: string; contactId?: string; campaignId?: string; email?: string };
export type RelationshipSuppressionDecision = {
  suppressed: boolean;
  effective?: RelationshipSuppression;
  active: RelationshipSuppression[];
  audit: Array<{ suppressionId: string; scope: SuppressionScope; reason: SuppressionReason; effectiveAt: string }>;
};

const precedence: Record<SuppressionScope, number> = {
  global: 5,
  email: 4,
  contact: 3,
  organization: 2,
  campaign: 1,
};

function isActive(suppression: RelationshipSuppression, now: Date) {
  return new Date(suppression.effectiveAt) <= now && (!suppression.expiresAt || new Date(suppression.expiresAt) > now);
}

function applies(suppression: RelationshipSuppression, subject: RelationshipSuppressionSubject) {
  if (suppression.scope === 'global') return true;
  if (suppression.scope === 'email') return Boolean(subject.email && suppression.email?.toLowerCase() === subject.email.toLowerCase());
  if (suppression.scope === 'contact') return suppression.contactId === subject.contactId;
  if (suppression.scope === 'organization') return suppression.organizationId === subject.organizationId;
  return suppression.campaignId === subject.campaignId;
}

/** Resolves relationship-only suppressions without reading client communication preferences. */
export function resolveRelationshipSuppression(input: { subject: RelationshipSuppressionSubject; suppressions: RelationshipSuppression[]; now?: Date }): RelationshipSuppressionDecision {
  const now = input.now ?? new Date();
  const active = input.suppressions
    .filter((suppression) => isActive(suppression, now) && applies(suppression, input.subject))
    .sort((left, right) => precedence[right.scope] - precedence[left.scope] || new Date(right.effectiveAt).getTime() - new Date(left.effectiveAt).getTime());
  const effective = active[0];
  return {
    suppressed: Boolean(effective),
    effective,
    active,
    audit: active.map((suppression) => ({ suppressionId: suppression.id, scope: suppression.scope, reason: suppression.reason, effectiveAt: suppression.effectiveAt })),
  };
}

export function relationshipSuppressionPrecedence(scope: SuppressionScope) {
  return precedence[scope];
}
