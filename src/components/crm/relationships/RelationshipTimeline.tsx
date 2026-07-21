import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { RelationshipInteraction } from '@/domain/relationships/contracts';
import { interactionTypeLabel } from '@/domain/relationships/lifecycle-workflow';

export function RelationshipTimeline({
  items,
  title = 'Relationship timeline',
  isLoading = false,
  error,
}: {
  items: RelationshipInteraction[];
  title?: string;
  isLoading?: boolean;
  error?: unknown;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>Relationship-only events; never clinical client activity.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-muted-foreground">Loading relationship activity…</p>}
        {!isLoading && error && (
          <p className="text-sm text-destructive">
            {error instanceof Error ? error.message : 'Relationship activity could not be loaded.'}
          </p>
        )}
        {!isLoading && !error && items.length === 0 && (
          <p className="text-sm text-muted-foreground">No relationship activity is available.</p>
        )}
        {!isLoading && !error && items.length > 0 && (
          <ol className="space-y-4">
            {items.map((item) => (
              <li key={item.id} className="border-b pb-4 last:border-0 last:pb-0">
                <p className="font-medium">{interactionTypeLabel(item.type)}</p>
                <p className="mt-1 text-sm text-muted-foreground">{item.summary}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {new Date(item.occurredAt).toLocaleString()}
                  {item.actorId ? ` · Actor ${item.actorId}` : ''}
                </p>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
