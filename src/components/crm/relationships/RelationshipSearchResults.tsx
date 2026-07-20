import { Link } from 'react-router-dom';
import type { RelationshipSearchResult } from '@/domain/relationships/contracts';

export function RelationshipSearchResults({ results }: { results: RelationshipSearchResult[] }) {
  if (!results.length) return <p className="text-sm text-muted-foreground">No relationship records match the search.</p>;
  return <div className="divide-y rounded border">{results.map((result) => <Link className="block p-3 hover:bg-muted/50" key={`${result.kind}-${result.id}`} to={result.route}><div className="flex flex-wrap items-center gap-2"><span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">Relationship · {result.kind}</span><span className="font-medium">{result.label}</span></div>{result.detail && <p className="mt-1 text-sm text-muted-foreground">{result.detail}</p>}</Link>)}</div>;
}
