import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RelationshipCapabilityState } from '@/components/crm/relationships/RelationshipCapabilityState';
import { useRelationshipCapability } from '@/hooks/relationships/useRelationshipCapabilities';

/** Capability-gated monitor for relationship campaigns only. */
export default function RelationshipCampaignMonitorPage() {
  const { capability, isLoading, isError, refetch } = useRelationshipCapability('campaigns');

  return <div className="space-y-6">
    <div>
      <h1 className="text-3xl font-bold tracking-tight">Relationship campaign monitor</h1>
      <p className="mt-2 max-w-3xl text-muted-foreground">Monitor relationship enrollment, schedule, sends, replies, pauses, failures, suppressions, eligibility changes, and performance without using clinical campaign data.</p>
    </div>
    <RelationshipCapabilityState state={capability} isLoading={isLoading} isError={isError} onRetry={() => { void refetch(); }} />
    {!capability?.available && !isLoading && !isError && <Card>
      <CardHeader><CardTitle>Monitor metrics pending</CardTitle><CardDescription>Metrics are unavailable until the typed relationship campaign adapter is installed. Zeroes are not shown because they would be misleading.</CardDescription></CardHeader>
    </Card>}
    {capability?.available && <Card>
      <CardHeader><CardTitle>No campaign activity loaded</CardTitle><CardDescription>The relationship monitor adapter is available but has not supplied campaign activity for this view.</CardDescription></CardHeader>
      <CardContent><p className="text-sm text-muted-foreground">Choose a relationship campaign when the typed monitor query is installed.</p></CardContent>
    </Card>}
  </div>;
}
