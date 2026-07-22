import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Building2, FileUp, Mail, Megaphone, ShieldBan, UsersRound, BarChart3, CircleHelp, Search } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useRelationshipCapabilities } from '@/hooks/relationships/useRelationshipCapabilities';
import type { Capability, CapabilityAvailability, RelationshipReportMetric } from '@/domain/relationships/contracts';
import { dataProvider } from '@/services/dataProvider';

const modules = [
  ['Search', '/crm/business-development/search', 'search', Search, 'Unified tenant-scoped search across relationships and outreach.'],
  ['Organizations', '/crm/business-development/organizations', 'organizations', Building2, 'Relationship organizations, ownership, next actions, and sources.'],
  ['Contacts', '/crm/business-development/contacts', 'contacts', UsersRound, 'Named contacts and clearly labeled role inboxes.'],
  ['BTY opportunities', '/crm/business-development/opportunities', 'opportunities', CircleHelp, 'Beyond The Yellow qualification and invitation pipeline.'],
  ['Imports', '/crm/business-development/imports', 'imports', FileUp, 'CSV preview, normalization, and conflict resolution.'],
  ['Relationship campaigns', '/crm/business-development/campaigns', 'campaigns', Megaphone, 'Separate outreach campaigns; never clinical campaign enrollments.'],
  ['Replies', '/crm/business-development/replies', 'replies', Mail, 'Relationship replies requiring staff follow-up.'],
  ['Suppressions', '/crm/business-development/suppressions', 'suppression', ShieldBan, 'Relationship-only unsubscribe and do-not-contact controls.'],
  ['Reports', '/crm/business-development/reports', 'reporting', BarChart3, 'Verified operational and selected-period reporting.'],
] as const satisfies readonly [string, string, Capability, typeof Building2, string][];

const dashboardMetrics = [
  ['organizations_needing_review', 'Organizations needing review'],
  ['opportunities_needing_qualification', 'BTY opportunities needing qualification'],
  ['overdue_next_actions', 'Overdue next actions'],
  ['unassigned_relationships', 'Unassigned relationships'],
  ['active_outreach_campaigns', 'Active outreach campaigns'],
  ['replies_requiring_staff_action', 'Replies requiring staff action'],
  ['import_conflicts', 'Import conflicts'],
  ['recently_updated_relationships', 'Recently updated relationships'],
] as const;

function capabilityLabel(state?: CapabilityAvailability) {
  if (!state) return 'Checking database support';
  if (state.available) return 'Database support available';
  return state.status.replace(/_/g, ' ');
}

function metricContent(
  state: CapabilityAvailability | undefined,
  metric: RelationshipReportMetric | undefined,
  loading: boolean,
  error: unknown,
) {
  if (!state) return { value: undefined, message: 'Checking reporting capability.' };
  if (!state.available) return { value: undefined, message: state.reason };
  if (loading) return { value: undefined, message: 'Loading verified metric.' };
  if (error) return { value: undefined, message: error instanceof Error ? error.message : 'Metric unavailable.' };
  if (!metric) return { value: undefined, message: 'The reporting contract did not return this metric.' };
  if (metric.value === undefined) return { value: undefined, message: metric.unavailableReason ?? 'This metric is unavailable.' };
  return { value: metric.value, message: undefined };
}

export default function BusinessDevelopmentDashboard() {
  const capabilities = useRelationshipCapabilities();
  const stateFor = (capability: Capability) => capabilities.data?.find((state) => state.capability === capability);
  const unavailable = capabilities.data?.filter((state) => !state.available).length ?? 0;
  const reportingState = stateFor('reporting');
  const metrics = useQuery({
    queryKey: ['relationship-dashboard-metrics'],
    queryFn: () => dataProvider.relationships.listReportMetrics(),
    enabled: reportingState?.available === true,
    retry: false,
  });
  const metricByKey = new Map(metrics.data?.map((metric) => [metric.key, metric]) ?? []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-2 flex flex-wrap gap-2">
            <Badge variant="outline">Business Development</Badge>
            <Badge variant="secondary">Live relationship read models</Badge>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Business Development dashboard</h1>
          <p className="mt-2 max-w-3xl text-muted-foreground">
            Managed relationships and Beyond The Yellow outreach, isolated from clinical CRM operations and inbound interest.
          </p>
        </div>
        <Link className="text-sm font-medium text-primary underline-offset-4 hover:underline" to="/crm/business-development/status">System status</Link>
      </div>

      <Card className={unavailable ? 'border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/10' : 'border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-950/10'}>
        <CardHeader>
          <CardTitle>{capabilities.isError ? 'Capability status unavailable' : unavailable ? 'Database integration status' : 'Relationship capabilities available'}</CardTitle>
          <CardDescription>
            {capabilities.isError
              ? 'The relationship capability snapshot could not be loaded. Metrics remain unavailable rather than displaying zeroes.'
              : capabilities.isLoading
                ? 'Checking the relationship capability snapshot before displaying metrics.'
                : unavailable
                  ? `${unavailable} relationship capabilities are unavailable. Affected values remain labeled instead of displaying false zeroes.`
                  : 'All registered relationship capabilities are available for this CRM tenant.'}
          </CardDescription>
        </CardHeader>
      </Card>

      <section aria-label="Business development modules" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {modules.map(([title, path, capability, Icon, description]) => {
          const state = stateFor(capability);
          return <Link key={path} to={path} className="focus:outline-none"><Card className="h-full transition-colors hover:border-primary"><CardHeader><Icon className="mb-2 h-5 w-5 text-primary" /><CardTitle className="text-base">{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent><Badge variant={state?.available ? 'default' : 'outline'}>{capabilityLabel(state)}</Badge></CardContent></Card></Link>;
        })}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Operational metrics</CardTitle>
          <CardDescription>Verified Billing Hub counts. A displayed zero is a real zero; unavailable metrics remain explicitly labeled.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {dashboardMetrics.map(([key, label]) => {
            const content = metricContent(reportingState, metricByKey.get(key), metrics.isLoading, metrics.error);
            return <div className="rounded border p-3" key={key}>
              <p className="text-sm font-medium">{label}</p>
              {content.value !== undefined
                ? <p className="mt-2 text-3xl font-semibold tabular-nums">{content.value.toLocaleString()}</p>
                : <p className="mt-2 text-sm text-muted-foreground">{content.message}</p>}
            </div>;
          })}
        </CardContent>
      </Card>
    </div>
  );
}
