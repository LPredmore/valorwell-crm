import { Link } from 'react-router-dom';
import { Building2, FileUp, Mail, Megaphone, ShieldBan, UsersRound, BarChart3, CircleHelp } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useRelationshipCapabilities } from '@/hooks/relationships/useRelationshipCapabilities';
import type { Capability, CapabilityAvailability } from '@/domain/relationships/contracts';

const modules = [
  ['Organizations', '/crm/business-development/organizations', 'organizations', Building2, 'Relationship organizations, ownership, next actions, and sources.'],
  ['Contacts', '/crm/business-development/contacts', 'contacts', UsersRound, 'Named contacts and clearly labeled role inboxes.'],
  ['BTY opportunities', '/crm/business-development/opportunities', 'opportunities', CircleHelp, 'Beyond The Yellow qualification and invitation pipeline.'],
  ['Imports', '/crm/business-development/imports', 'imports', FileUp, 'CSV preview, normalization, and conflict resolution.'],
  ['Relationship campaigns', '/crm/business-development/campaigns', 'campaigns', Megaphone, 'Separate outreach campaigns; never clinical campaign enrollments.'],
  ['Replies', '/crm/business-development/replies', 'replies', Mail, 'Relationship replies requiring staff follow-up.'],
  ['Suppressions', '/crm/business-development/suppressions', 'suppression', ShieldBan, 'Relationship-only unsubscribe and do-not-contact controls.'],
  ['Reports', '/crm/business-development/reports', 'reporting', BarChart3, 'Operational reporting with truthful pending states.'],
] as const satisfies readonly [string, string, Capability, typeof Building2, string][];

const metrics = [
  ['Organizations needing review', 'organizations'],
  ['BTY opportunities needing qualification', 'opportunities'],
  ['Overdue next actions', 'interactions'],
  ['Unassigned relationships', 'organizations'],
  ['Active outreach campaigns', 'campaigns'],
  ['Replies requiring staff action', 'replies'],
  ['Import conflicts', 'imports'],
  ['Recently updated relationships', 'organizations'],
] as const satisfies readonly [string, Capability][];

function capabilityLabel(state?: CapabilityAvailability) {
  if (!state) return 'Checking database support';
  if (state.available) return 'Database support available';
  return state.status.replace(/_/g, ' ');
}

function metricMessage(state?: CapabilityAvailability) {
  if (!state) return 'Checking database support before loading this metric.';
  if (state.available) return 'Database support is available; this metric will appear after its integration is verified.';
  return state.reason;
}

export default function BusinessDevelopmentDashboard() {
  const capabilities = useRelationshipCapabilities();
  const stateFor = (capability: Capability) => capabilities.data?.find((state) => state.capability === capability);
  const unavailable = capabilities.data?.filter((state) => !state.available).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-2 flex flex-wrap gap-2">
            <Badge variant="outline">Business Development</Badge>
            <Badge variant="secondary">Application code implemented</Badge>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Business Development dashboard</h1>
          <p className="mt-2 max-w-3xl text-muted-foreground">
            Managed relationships and Beyond The Yellow outreach, isolated from clinical CRM operations and inbound interest.
          </p>
        </div>
        <Link className="text-sm font-medium text-primary underline-offset-4 hover:underline" to="/crm/business-development/status">System status</Link>
      </div>

      <Card className="border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/10">
        <CardHeader>
          <CardTitle>{capabilities.isError ? 'Capability status unavailable' : 'Database integration status'}</CardTitle>
          <CardDescription>
            {capabilities.isError
              ? 'The relationship capability snapshot could not be loaded. Metrics remain unavailable rather than displaying zeroes.'
              : capabilities.isLoading
                ? 'Checking the relationship capability snapshot before displaying metrics.'
                : `${unavailable} relationship capabilities are awaiting database support. Metrics intentionally show their true availability rather than zero.`}
          </CardDescription>
        </CardHeader>
      </Card>

      <section aria-label="Business development modules" className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {modules.map(([title, path, capability, Icon, description]) => {
          const state = stateFor(capability);
          return <Link key={path} to={path} className="focus:outline-none"><Card className="h-full transition-colors hover:border-primary"><CardHeader><Icon className="mb-2 h-5 w-5 text-primary" /><CardTitle className="text-base">{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent><Badge variant={state?.available ? 'default' : 'outline'}>{capabilityLabel(state)}</Badge></CardContent></Card></Link>;
        })}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Operational metrics</CardTitle>
          <CardDescription>Counts appear only when the relevant database capability and metric integration are verified.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {metrics.map(([label, capability]) => {
            const state = stateFor(capability);
            return <div className="rounded border p-3" key={label}><p className="text-sm font-medium">{label}</p><p className="mt-2 text-sm text-muted-foreground">{metricMessage(state)}</p></div>;
          })}
        </CardContent>
      </Card>
    </div>
  );
}
