import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RelationshipCapabilityState } from '@/components/crm/relationships/RelationshipCapabilityState';
import { RelationshipReportMetrics } from '@/components/crm/relationships/RelationshipReportMetrics';
import { useRelationshipCapability } from '@/hooks/relationships/useRelationshipCapabilities';
import { relationshipReportMetrics } from '@/services/relationships/reporting';

/** Capability-gated reporting; pending relationship metrics are never shown as zero. */
export default function RelationshipReportingPage() {
  const { capability, isLoading, isError, refetch } = useRelationshipCapability('reporting');
  const metrics = relationshipReportMetrics({ capability });
  return <div className="space-y-6"><div><h1 className="text-3xl font-bold tracking-tight">Business Development reports</h1><p className="mt-2 max-w-3xl text-muted-foreground">Relationship-only operational metrics for organizations, outreach, campaign activity, replies, suppression, and failures.</p></div><RelationshipCapabilityState state={capability} isLoading={isLoading} isError={isError} onRetry={() => { void refetch(); }} /><Card><CardHeader><CardTitle>Operational metrics</CardTitle><CardDescription>Unavailable capability data remains unavailable; it is not presented as zero activity.</CardDescription></CardHeader><CardContent><RelationshipReportMetrics metrics={metrics} /></CardContent></Card></div>;
}
