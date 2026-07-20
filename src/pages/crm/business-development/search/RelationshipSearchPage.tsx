import { useState } from 'react';
import { Search } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RelationshipCapabilityState } from '@/components/crm/relationships/RelationshipCapabilityState';
import { useRelationshipCapability } from '@/hooks/relationships/useRelationshipCapabilities';

/** Dedicated relationship search. Canonical clinical and inbound search semantics remain unchanged. */
export default function RelationshipSearchPage() {
  const [query, setQuery] = useState('');
  const { capability, isLoading, isError, refetch } = useRelationshipCapability('search');
  return <div className="space-y-6"><div><h1 className="text-3xl font-bold tracking-tight">Relationship search</h1><p className="mt-2 max-w-3xl text-muted-foreground">Search organizations, contacts, opportunities, and relationship campaigns by relationship-specific fields. Clinical and inbound results are not included.</p></div><Card><CardHeader><CardTitle>Search relationship records</CardTitle><CardDescription>Search name, organization, email, website, initiative, owner, stage, and status.</CardDescription></CardHeader><CardContent><Label htmlFor="relationship-search">Search</Label><div className="relative mt-2"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input id="relationship-search" className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Organization, contact, initiative, or email" /></div></CardContent></Card><RelationshipCapabilityState state={capability} isLoading={isLoading} isError={isError} onRetry={() => { void refetch(); }} />{!capability?.available && !isLoading && !isError && <Card><CardHeader><CardTitle>Relationship search pending</CardTitle><CardDescription>Search results remain unavailable until the typed relationship search adapter is installed. No clinical or inbound results are substituted.</CardDescription></CardHeader></Card>}{capability?.available && <Card><CardHeader><CardTitle>No relationship results loaded</CardTitle><CardDescription>The relationship search adapter is available but has not supplied results for this query.</CardDescription></CardHeader></Card>}</div>;
}
