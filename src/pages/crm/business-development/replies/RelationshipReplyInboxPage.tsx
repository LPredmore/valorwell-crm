import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RelationshipCapabilityState } from '@/components/crm/relationships/RelationshipCapabilityState';
import { useRelationshipCapability } from '@/hooks/relationships/useRelationshipCapabilities';

/** Relationship-only inbox; it does not fall back to clinical communications. */
export default function RelationshipReplyInboxPage() {
  const { capability, isLoading, isError, refetch } = useRelationshipCapability('replies');
  return <div className="space-y-6">
    <div><h1 className="text-3xl font-bold tracking-tight">Relationship replies</h1><p className="mt-2 max-w-3xl text-muted-foreground">Review, assign, and follow up on relationship replies. Matching, enrollment stops, and audit context remain inside the relationship domain.</p></div>
    <RelationshipCapabilityState state={capability} isLoading={isLoading} isError={isError} onRetry={() => { void refetch(); }} />
    {!capability?.available && !isLoading && !isError && <Card><CardHeader><CardTitle>Reply inbox pending</CardTitle><CardDescription>Relationship replies are unavailable until the typed reply adapter is installed. Clinical communications are not used as a fallback.</CardDescription></CardHeader></Card>}
    {capability?.available && <Card><CardHeader><CardTitle>No relationship replies loaded</CardTitle><CardDescription>The reply adapter is available but has not supplied reply records for this inbox.</CardDescription></CardHeader><CardContent><p className="text-sm text-muted-foreground">Reply ownership and next actions will appear when the typed relationship query is installed.</p></CardContent></Card>}
  </div>;
}
