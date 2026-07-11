import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Clock3 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

const db = supabase as any;

interface ActiveException {
  id: string;
  category: string;
  reason_code: string;
  reason_detail: string;
  resolution_state: 'open' | 'in_progress';
  owner_profile_id: string | null;
  next_action: string;
  review_due_at: string;
  overdue: boolean;
}

interface ExceptionSummary {
  tenant_id: string;
  client_id: string;
  active_exception_count: number;
  overdue_exception_count: number;
  next_review_due_at: string | null;
  categories: string[];
  highest_priority_reason_code: string | null;
  highest_priority_next_action: string | null;
  active_exceptions: ActiveException[];
}

const formatDateTime = (value: string) => new Intl.DateTimeFormat('en-US', {
  dateStyle: 'short',
  timeStyle: 'short',
}).format(new Date(value));

export function ClientJourneyExceptionSummary({ clientId, tenantId }: { clientId: string; tenantId: string }) {
  const { data, isLoading } = useQuery<ExceptionSummary | null>({
    queryKey: ['crm-client-journey-exceptions', tenantId, clientId],
    queryFn: async () => {
      const { data: summary, error } = await db
        .from('client_journey_exception_current_summary')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('client_id', clientId)
        .maybeSingle();
      if (error) throw error;
      return summary ?? null;
    },
    enabled: !!tenantId && !!clientId,
  });

  if (isLoading) return <Skeleton className="h-40" />;

  if (!data || data.active_exception_count === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
            Client Journey Exceptions
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          No active operational exceptions.
        </CardContent>
      </Card>
    );
  }

  const exceptions = data.active_exceptions ?? [];

  return (
    <Card className={data.overdue_exception_count > 0 ? 'border-destructive/60' : undefined}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className={data.overdue_exception_count > 0 ? 'h-4 w-4 text-destructive' : 'h-4 w-4'} />
            Client Journey Exceptions
          </CardTitle>
          <Badge variant={data.overdue_exception_count > 0 ? 'destructive' : 'secondary'}>
            {data.active_exception_count} active
          </Badge>
        </div>
        <div className="flex flex-wrap gap-1 pt-2">
          {data.categories.map((category) => <Badge key={category} variant="outline">{category}</Badge>)}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {exceptions.slice(0, 3).map((exception) => (
          <div key={exception.id} className="rounded-md border p-3 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium capitalize">{exception.reason_code.replaceAll('_', ' ')}</span>
              {exception.overdue && <Badge variant="destructive">Overdue</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">{exception.reason_detail}</p>
            <p className="text-sm"><strong>Next:</strong> {exception.next_action}</p>
            <p className={exception.overdue ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
              <Clock3 className="inline h-3 w-3 mr-1" />
              Review by {formatDateTime(exception.review_due_at)}
            </p>
          </div>
        ))}
        {exceptions.length > 3 && (
          <p className="text-xs text-muted-foreground">+{exceptions.length - 3} additional active exceptions</p>
        )}
      </CardContent>
    </Card>
  );
}
