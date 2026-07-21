import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Plus, RotateCcw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { RelationshipCapabilityState } from '@/components/crm/relationships/RelationshipCapabilityState';
import { RelationshipPagination } from '@/components/crm/relationships/RelationshipWorkspacePrimitives';
import { relationshipStageLabel } from '@/domain/relationships/lifecycle-workflow';
import { useRelationshipCapability } from '@/hooks/relationships/useRelationshipCapabilities';
import { useOrganizationDirectory, useOrganizationDirectoryFilters } from '@/hooks/relationships/useOrganizationDirectory';

const textFilters = [
  ['organization-outreach', 'Outreach status', 'outreachStatus', 'e.g. contacted'],
  ['organization-kind', 'Organization kind', 'organizationKind', 'e.g. nonprofit'],
  ['organization-owner', 'Assigned owner', 'owner', 'Owner profile ID'],
] as const;

const booleanFilters = [
  ['veteranAffiliated', 'Veteran affiliated'],
  ['overdue', 'Overdue next action'],
  ['doNotContact', 'Do not contact'],
] as const;

export default function OrganizationDirectoryPage() {
  const { capability, isLoading: capabilityLoading, isError: capabilityError, refetch } = useRelationshipCapability('organizations');
  const { filters, set, setMany, reset } = useOrganizationDirectoryFilters();
  const directory = useOrganizationDirectory(filters, capability?.available === true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const items = directory.data?.items ?? [];

  const toggleSelected = (id: string, checked: boolean) => setSelectedIds((current) =>
    checked ? [...new Set([...current, id])] : current.filter((value) => value !== id),
  );
  const available = capability?.available === true;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Organizations</h1>
          <p className="mt-2 max-w-3xl text-muted-foreground">Search, filter, and manage non-clinical relationship organizations in Billing Hub.</p>
        </div>
        <div className="flex gap-2">
          {available && <Button asChild><Link to="/crm/business-development/organizations/new"><Plus className="mr-2 h-4 w-4" />New organization</Link></Button>}
          <Button asChild variant="outline"><Link to="/crm/business-development/status">System status</Link></Button>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Directory filters</CardTitle><CardDescription>Only fields stored by the current Billing Hub relationship schema are available.</CardDescription></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-2"><Label htmlFor="organization-search">Search</Label><div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input id="organization-search" className="pl-9" value={filters.search ?? ''} onChange={(event) => set('q', event.target.value)} placeholder="Name or website" /></div></div>
          {textFilters.map(([id, label, key, placeholder]) => <div className="space-y-2" key={id}><Label htmlFor={id}>{label}</Label><Input id={id} value={filterValue(filters, key) ?? ''} onChange={(event) => set(key, event.target.value)} placeholder={placeholder} /></div>)}
          {booleanFilters.map(([key, label]) => <div className="space-y-2" key={key}><Label htmlFor={`organization-${key}`}>{label}</Label><select id={`organization-${key}`} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={filterValue(filters, key) ?? ''} onChange={(event) => set(key, event.target.value)}><option value="">Any</option><option value="true">Yes</option><option value="false">No</option></select></div>)}
          <div className="space-y-2"><Label htmlFor="organization-contacted">Contact history</Label><select id="organization-contacted" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={filters.contacted ?? ''} onChange={(event) => set('contacted', event.target.value)}><option value="">Any</option><option value="recently">Contacted in the last 30 days</option><option value="never">Never contacted</option></select></div>
          <div className="space-y-2"><Label htmlFor="organization-sort">Sort</Label><select id="organization-sort" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={`${filters.sortBy}:${filters.sortDirection}`} onChange={(event) => { const [sortBy, sortDirection] = event.target.value.split(':'); setMany({ sortBy, sortDirection }); }}><option value="name:asc">Name, A–Z</option><option value="name:desc">Name, Z–A</option><option value="updatedAt:desc">Recently updated</option><option value="nextActionDueAt:asc">Next action due</option></select></div>
          <div className="flex items-end gap-3"><Button type="button" variant="outline" onClick={reset}><RotateCcw className="mr-2 h-4 w-4" />Reset filters</Button><p className="pb-2 text-sm text-muted-foreground">{selectedIds.length} selected</p></div>
        </CardContent>
      </Card>

      <RelationshipCapabilityState state={capability} isLoading={capabilityLoading} isError={capabilityError} onRetry={() => { void refetch(); }} />

      {available && directory.isLoading && <Card aria-label="Loading organizations"><CardHeader><Skeleton className="h-6 w-48" /><Skeleton className="h-4 w-full" /></CardHeader></Card>}
      {available && directory.isError && <Card><CardHeader><CardTitle>Organizations could not be loaded</CardTitle><CardDescription>{directory.error instanceof Error ? directory.error.message : 'Try again later.'}</CardDescription></CardHeader><CardContent><Button variant="outline" onClick={() => { void directory.refetch(); }}>Try again</Button></CardContent></Card>}
      {available && directory.data && <Card>
        <CardHeader><CardTitle>Organization results</CardTitle><CardDescription>{directory.data.total} matching relationship organizations.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {items.length === 0 ? <p className="text-sm text-muted-foreground">No organizations match the current filters.</p> : <div className="divide-y rounded border">{items.map((organization) => <div className="flex items-center gap-3 p-3" key={organization.id}><Checkbox aria-label={`Select ${organization.name}`} checked={selectedIds.includes(organization.id)} onCheckedChange={(checked) => toggleSelected(organization.id, checked === true)} /><div className="min-w-0 flex-1"><Link className="font-medium text-primary underline-offset-4 hover:underline" to={`/crm/business-development/organizations/${organization.id}`}>{organization.name}</Link><p className="truncate text-sm text-muted-foreground">{organization.organizationKind ?? 'Kind not recorded'} · {relationshipStageLabel(organization.stage)} · {organization.outreachStatus.replace(/_/g, ' ')}</p></div><p className="hidden text-sm text-muted-foreground md:block">{organization.nextAction ?? 'No next action'}</p></div>)}</div>}
          <RelationshipPagination page={directory.data.page} pageSize={directory.data.pageSize} total={directory.data.total} onPageChange={(page) => set('page', String(page))} />
        </CardContent>
      </Card>}

      {!available && !capabilityLoading && !capabilityError && <Card><CardHeader><Building2 className="mb-2 h-5 w-5 text-primary" /><CardTitle>Organization database access unavailable</CardTitle><CardDescription>{capability?.reason ?? 'The tenant-scoped organization capability could not be verified.'}</CardDescription></CardHeader></Card>}
    </div>
  );
}

function filterValue(filters: ReturnType<typeof useOrganizationDirectoryFilters>['filters'], key: string) {
  const map: Record<string, unknown> = {
    outreachStatus: filters.outreachStatuses?.[0],
    organizationKind: filters.organizationKinds?.[0],
    owner: filters.ownerIds?.[0],
    veteranAffiliated: filters.veteranAffiliated,
    overdue: filters.overdueNextAction,
    doNotContact: filters.doNotContact,
  };
  const value = map[key];
  return typeof value === 'boolean' ? String(value) : typeof value === 'string' ? value : undefined;
}
