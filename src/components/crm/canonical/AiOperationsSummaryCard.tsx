import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  buildAiOperationsWidgetSummary,
  fetchAiOperationsOverview,
} from '@/lib/crm/ai-operations';

const statusVariant = (status: string) =>
  status === 'success' ? 'secondary' : status === 'failed' ? 'destructive' : 'outline';

/**
 * Compact AI Operations summary for the Operations Dashboard. Reads the precomputed
 * overview only, and never breaks the rest of the page when AI Operations is off.
 */
export function AiOperationsSummaryCard() {
  const overview = useQuery({
    queryKey: ['ai-operations', 'overview', 'widget'],
    queryFn: () => fetchAiOperationsOverview(),
    retry: false,
    staleTime: 60_000,
  });

  const summary = buildAiOperationsWidgetSummary(overview.data);
  const unavailable = overview.isError || (!overview.isPending && !overview.data?.run);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="h-4 w-4 text-muted-foreground" />
          AI Operations
        </CardTitle>
        <Button asChild size="sm" variant="ghost">
          <Link to="/crm/ai-operations">Open</Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {overview.isPending && <p className="text-sm text-muted-foreground">Loading AI Operations summary…</p>}

        {!overview.isPending && unavailable && (
          <p className="text-sm text-muted-foreground">
            AI Operations is switched off or has not produced a brief yet.
          </p>
        )}

        {!overview.isPending && !unavailable && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{summary.businessDate}</span>
              <Badge variant={summary.briefStatus === 'published' ? 'secondary' : 'outline'}>
                Brief: {summary.briefStatus}
                {summary.briefIsPartial ? ' (partial)' : ''}
              </Badge>
              {summary.briefGeneratedAt && (
                <span className="text-xs text-muted-foreground">
                  Generated {new Date(summary.briefGeneratedAt).toLocaleTimeString()}
                </span>
              )}
            </div>

            <div className="flex gap-4 text-sm">
              <span>Critical <strong>{summary.criticalCount}</strong></span>
              <span>High <strong>{summary.highCount}</strong></span>
              <span>Open <strong>{summary.openCount}</strong></span>
            </div>

            <div className="flex flex-wrap gap-2">
              {summary.modules.map((module) => (
                <Badge key={module.module} variant={statusVariant(module.status)}>
                  {module.label}: {module.status}
                </Badge>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default AiOperationsSummaryCard;
