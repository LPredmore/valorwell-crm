import type { RelationshipSearchResult } from '@/domain/relationships/contracts';

export type RelationshipSearchDocument = RelationshipSearchResult & {
  organizationName?: string;
  contactName?: string;
  email?: string;
  website?: string;
  initiative?: string;
  ownerName?: string;
  stage?: string;
  status?: string;
};

/** Searches only supplied relationship documents; clinical and inbound records are intentionally absent. */
export function searchRelationshipDocuments(documents: RelationshipSearchDocument[], query: string): RelationshipSearchResult[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return documents.filter((document) => {
    const haystack = [document.label, document.detail, document.organizationName, document.contactName, document.email, document.website, document.initiative, document.ownerName, document.stage, document.status]
      .filter(Boolean).join(' ').toLowerCase();
    return terms.every((term) => haystack.includes(term));
  }).map(({ id, kind, label, detail, route }) => ({ id, kind, label, detail, route }));
}
