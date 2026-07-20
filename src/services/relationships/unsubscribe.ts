import type { CapabilityAvailability, RelationshipUnsubscribeRequest } from '@/domain/relationships/contracts';

export type RelationshipUnsubscribePlan = {
  tokenId?: string;
  outcome: RelationshipUnsubscribeRequest['outcome'];
  message: string;
  idempotent: boolean;
};

function opaqueHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/** Produces an opaque identifier for audit/query boundaries and never returns the raw token. */
export function relationshipUnsubscribeTokenId(token: string) {
  return `relationship-unsubscribe-${opaqueHash(token)}`;
}

/**
 * Plans a public, idempotent relationship unsubscribe. The plan never reads
 * or changes clinical communication preferences, and is inert until the typed
 * relationship unsubscribe capability is installed.
 */
export function planRelationshipUnsubscribe(input: {
  token?: string;
  capability?: CapabilityAvailability;
  existingOutcome?: Extract<RelationshipUnsubscribeRequest['outcome'], 'unsubscribed' | 'already_unsubscribed'>;
}): RelationshipUnsubscribePlan {
  if (!input.token || input.token.trim().length < 16) return { outcome: 'invalid_token', message: 'This unsubscribe link is invalid or has expired.', idempotent: true };
  if (input.existingOutcome) return { tokenId: relationshipUnsubscribeTokenId(input.token), outcome: 'already_unsubscribed', message: 'This address has already been unsubscribed from relationship outreach.', idempotent: true };
  if (input.capability?.available !== true) return { tokenId: relationshipUnsubscribeTokenId(input.token), outcome: 'pending', message: 'Relationship unsubscribe processing is not available yet. No preferences were changed.', idempotent: true };
  return { tokenId: relationshipUnsubscribeTokenId(input.token), outcome: 'unsubscribed', message: 'This address is ready to be unsubscribed from relationship outreach.', idempotent: true };
}
