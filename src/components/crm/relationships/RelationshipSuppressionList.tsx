import type { RelationshipSuppression } from '@/domain/relationships/contracts';

export function RelationshipSuppressionList({ suppressions }: { suppressions: RelationshipSuppression[] }) {
  if (!suppressions.length) return <p className="text-sm text-muted-foreground">No active relationship suppressions match this view.</p>;
  return <div className="divide-y rounded border">{suppressions.map((suppression) => <article className="p-3" key={suppression.id}><p className="font-medium">{suppression.scope} · {suppression.reason}</p><p className="mt-1 text-sm text-muted-foreground">Effective {suppression.effectiveAt}{suppression.expiresAt ? ` · Expires ${suppression.expiresAt}` : ' · No expiration'}</p></article>)}</div>;
}
