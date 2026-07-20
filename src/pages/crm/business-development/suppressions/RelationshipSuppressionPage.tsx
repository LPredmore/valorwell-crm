import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RelationshipCapabilityState } from '@/components/crm/relationships/RelationshipCapabilityState';
import { useRelationshipCapability } from '@/hooks/relationships/useRelationshipCapabilities';

/** Capability-gated relationship suppression workspace. */
export default function RelationshipSuppressionPage() {
  const { capability, isLoading, isError, refetch } = useRelationshipCapability('suppression');
  return <div className="space-y-6">
    <div><h1 className="text-3xl font-bold tracking-tight">Relationship suppressions</h1><p className="mt-2 max-w-3xl text-muted-foreground">Review relationship-only global, email, contact, organization, and campaign suppression controls with reason, dates, and audit context.</p></div>
    <RelationshipCapabilityState state={capability} isLoading={isLoading} isError={isError} onRetry={() => { void refetch(); }} />
    {!capability?.available && !isLoading && !isError && <Card><CardHeader><CardTitle>Suppressions pending</CardTitle><CardDescription>Suppression records and audit history are unavailable until the typed relationship suppression adapter is installed. Clinical communication preferences are never used as a fallback.</CardDescription></CardHeader></Card>}
    {capability?.available && <Card><CardHeader><CardTitle>No suppressions loaded</CardTitle><CardDescription>The relationship suppression adapter is available but has not supplied records for this view.</CardDescription></CardHeader><CardContent><p className="text-sm text-muted-foreground">Create, edit, expiry, and audit actions remain capability-gated.</p></CardContent></Card>}
  </div>;
}
