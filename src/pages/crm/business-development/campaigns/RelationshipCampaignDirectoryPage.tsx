import { Link } from 'react-router-dom';
import { RotateCcw, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { RelationshipCapabilityState } from '@/components/crm/relationships/RelationshipCapabilityState';
import { RelationshipPagination } from '@/components/crm/relationships/RelationshipWorkspacePrimitives';
import { useRelationshipCapability } from '@/hooks/relationships/useRelationshipCapabilities';
import { useRelationshipCampaignDirectory, useRelationshipCampaignDirectoryFilters } from '@/hooks/relationships/useRelationshipCampaignDirectory';
import type { RelationshipCampaign, RelationshipCampaignStatus } from '@/domain/relationships/contracts';

const statusOptions: RelationshipCampaignStatus[] = ['draft', 'active', 'paused', 'completed', 'archived'];
const statusLabel: Record<RelationshipCampaignStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
  archived: 'Archived',
};

export default function RelationshipCampaignDirectoryPage() {
  const { capability, isLoading: capabilityLoading, isError: capabilityError, refetch } = useRelationshipCapability('campaigns');
  const { filters, set, setMany, reset } = useRelationshipCampaignDirectoryFilters();
  const directory = useRelationshipCampaignDirectory(filters, capability?.available === true);
  const available = capability?.available === true;
  const items = directory.data?.items ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Relationship campaigns</h1>
          <p className="mt-2 max-w-3xl text-muted-foreground">Relationship-only outreach campaigns that never rely on clinical campaign infrastructure, client records, or Creator/Community Interest data.</p>
        </div>
        <Button asChild variant="outline"><Link to="/crm/business-development/status">System status</Link></Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Directory filters</CardTitle>
          <CardDescription>Filter by status, owner, initiative, and free-text search. The URL keeps the current view shareable and deterministic.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="campaign-search">Search</Label>
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input id="campaign-search" className="pl-9" value={filters.search ?? ''} onChange={(event) => set('q', event.target.value)} placeholder="Campaign name or purpose" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="campaign-status">Status</Label>
            <select id="campaign-status" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={filters.statuses?.[0] ?? ''} onChange={(event) => set('status', event.target.value)}>
              <option value="">Any</option>
              {statusOptions.map((status) => <option key={status} value={status}>{statusLabel[status]}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="campaign-owner">Owner</Label>
            <Input id="campaign-owner" value={filters.ownerIds?.[0] ?? ''} onChange={(event) => set('owner', event.target.value)} placeholder="Owner ID" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="campaign-initiative">Initiative</Label>
            <Input id="campaign-initiative" value={filters.initiatives?.[0] ?? ''} onChange={(event) => set('initiative', event.target.value)} placeholder="e.g. BTY" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="campaign-sort">Sort</Label>
            <select id="campaign-sort" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={`${filters.sortBy}:${filters.sortDirection}`} onChange={(event) => { const [sortBy, sortDirection] = event.target.value.split(':'); setMany({ sortBy, sortDirection }); }}>
              <option value="updatedAt:desc">Recently updated</option>
              <option value="name:asc">Name, A–Z</option>
              <option value="name:desc">Name, Z–A</option>
              <option value="status:asc">Status</option>
            </select>
          </div>
          <div className="flex items-end">
            <Button type="button" variant="outline" onClick={reset}><RotateCcw className="mr-2 h-4 w-4" />Reset filters</Button>
          </div>
        </CardContent>
      </Card>

      <RelationshipCapabilityState state={capability} isLoading={capabilityLoading} isError={capabilityError} onRetry={() => { void refetch(); }} />

      {available && directory.isLoading && <Card aria-label="Loading relationship campaigns"><CardHeader><Skeleton className="h-6 w-48" /><Skeleton className="h-4 w-full" /></CardHeader></Card>}
      {available && directory.isError && <Card><CardHeader><CardTitle>Relationship campaigns could not be loaded</CardTitle><CardDescription>Try again later. No clinical campaign data was used as a fallback.</CardDescription></CardHeader><CardContent><Button variant="outline" onClick={() => { void directory.refetch(); }}>Try again</Button></CardContent></Card>}
      {available && directory.data && <Card>
        <CardHeader>
          <CardTitle>Relationship campaign results</CardTitle>
          <CardDescription>{directory.data.total} matching relationship campaigns.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {items.length === 0 ? <p className="text-sm text-muted-foreground">No relationship campaigns match the current filters.</p> : <div className="divide-y rounded border">{items.map((campaign) => <div className="space-y-3 p-4" key={campaign.id}><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-medium">{campaign.name}</h2><p className="text-sm text-muted-foreground">{campaign.purpose}</p></div><Badge variant="outline">{statusLabel[campaign.status]}</Badge></div><div className="flex flex-wrap gap-3 text-sm text-muted-foreground"><span>{campaign.initiative ?? 'No initiative'}</span><span>Owner {campaign.ownerId ?? 'unassigned'}</span><span>{campaign.senderName}</span></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <MetricCard label="Enrollment" value={campaign.enrollmentCount} />
            <MetricCard label="Replies" value={campaign.replyCount} />
            <MetricCard label="Suppressions" value={campaign.suppressionCount} />
            <MetricCard label="Upcoming send" value={undefined} />
            <MetricCard label="Errors" value={campaign.errorCount} />
          </div></div>)}</div>}
          <RelationshipPagination page={directory.data.page} pageSize={directory.data.pageSize} total={directory.data.total} onPageChange={(page) => set('page', String(page))} />
        </CardContent>
      </Card>}

      {!available && !capabilityLoading && !capabilityError && <Card><CardHeader><CardTitle>Directory ready for database support</CardTitle><CardDescription>Filters and navigation are available, but relationship campaigns remain unavailable until the typed relationship database capability is installed.</CardDescription></CardHeader></Card>}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value?: number }) {
  return <div className="rounded border p-3"><p className="text-sm font-medium">{label}</p><p className="mt-2 text-sm text-muted-foreground">{value === undefined ? 'Pending' : value}</p></div>;
}
