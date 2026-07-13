import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCrmAuth } from '@/hooks/crm/useCrmAuth';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';

interface FunnelRow {
  stage: string;
  count: number;
  avg_time_in_stage_hours: number | null;
}

interface AtRiskRow {
  metric: string;
  value: number;
}

interface ClosureRow {
  disposition_reason: string;
  count: number;
}

interface AttributionRow {
  attribution_confidence: string;
  count: number;
}

function useReport<T>(viewName: string) {
  const { tenantId, isAuthenticated } = useCrmAuth();
  return useQuery({
    queryKey: ['report', viewName, tenantId],
    enabled: isAuthenticated && !!tenantId,
    queryFn: async (): Promise<{ rows: T[]; error?: string }> => {
      const { data, error } = await (supabase as any)
        .from(viewName)
        .select('*')
        .eq('tenant_id', tenantId);
      if (error) return { rows: [], error: error.message };
      return { rows: (data ?? []) as T[] };
    },
  });
}

function ReportTable({ title, viewName, columns }: {
  title: string;
  viewName: string;
  columns: { key: string; label: string }[];
}) {
  const { data, isLoading } = useReport<Record<string, unknown>>(viewName);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : data?.error ? (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Canonical reporting view <code>{viewName}</code> not yet published: {data.error}
            </AlertDescription>
          </Alert>
        ) : (data?.rows.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">No data yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map(c => <TableHead key={c.key}>{c.label}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.rows.map((row, i) => (
                <TableRow key={i}>
                  {columns.map(c => (
                    <TableCell key={c.key}>{String(row[c.key] ?? '—')}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export default function CrmReports() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Reports</h1>
        <p className="text-sm text-muted-foreground">
          Journey funnel, at-risk, closures, attribution. Sourced from canonical reporting views.
        </p>
      </div>

      <ReportTable
        title="Journey funnel"
        viewName="v_journey_funnel"
        columns={[
          { key: 'stage', label: 'Stage' },
          { key: 'count', label: 'Count' },
          { key: 'avg_time_in_stage_hours', label: 'Avg time (hrs)' },
        ]}
      />

      <ReportTable
        title="At-Risk metrics"
        viewName="v_at_risk_metrics"
        columns={[
          { key: 'metric', label: 'Metric' },
          { key: 'value', label: 'Value' },
        ]}
      />

      <ReportTable
        title="Closures by disposition"
        viewName="v_closure_by_reason"
        columns={[
          { key: 'disposition_reason', label: 'Disposition' },
          { key: 'count', label: 'Count' },
        ]}
      />

      <ReportTable
        title="Attribution confidence"
        viewName="v_attribution_confidence"
        columns={[
          { key: 'attribution_confidence', label: 'Confidence' },
          { key: 'count', label: 'Clients' },
        ]}
      />
    </div>
  );
}
