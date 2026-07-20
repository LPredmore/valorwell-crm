import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, RotateCcw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { RelationshipCapabilityState } from '@/components/crm/relationships/RelationshipCapabilityState';
import { RelationshipPagination } from '@/components/crm/relationships/RelationshipWorkspacePrimitives';
import { useRelationshipCapability } from '@/hooks/relationships/useRelationshipCapabilities';
import { useOrganizationDirectory, useOrganizationDirectoryFilters } from '@/hooks/relationships/useOrganizationDirectory';

const textFilters = [
  ['organization-stage', 'Relationship stage', 'stage', 'e.g. identified'],
  ['organization-review', 'Review status', 'reviewStatus', 'e.g. approved'],
  ['organization-outreach', 'Outreach status', 'outreachStatus', 'e.g. contacted'],
  ['organization-type', 'Organization type', 'organizationType', 'e.g. nonprofit'],
  ['organization-owner', 'Assigned owner', 'owner', 'Owner ID'],
  ['organization-role', 'Role', 'roleCode', 'Role code'],
  ['organization-initiative', 'ValorWell initiative', 'initiative', 'Initiative'],
  ['organization-state', 'State or service area', 'state', 'e.g. VA'],
  ['organization-referral', 'Referral source category', 'referralCategory', 'e.g. research'],
  ['organization-opportunity', 'BTY opportunity status', 'opportunityStatus', 'e.g. qualified'],
] as const;

const booleanFilters = [
  ['veteranAffiliation', 'Veteran affiliation'],
  ['hasSocialPresence', 'Social presence'],
  ['overdue', 'Overdue next action'],
  ['doNotContact', 'Do not contact'],
] as const;

export default function OrganizationDirectoryPage() {
  const { capability, isLoading: capabilityLoading, isError: capabilityError, refetch } = useRelationshipCapability('organizations');
  const { filters, set, setMany, reset } = useOrganizationDirectoryFilters();
  const directory = useOrganizationDirectory(filters, capability?.available === true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const items = directory.data?.items ?? [];

  const toggleSelected = (id: string, checked: boolean) => setSelectedIds((current) => checked ? [...current, id] : current.filter((value) => value !== id));
  const available = capability?.available === true;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Organizations</h1>
          <p className="mt-2 max-w-3xl text-muted-foreground">Search, filter, sort, and review relationship organizations. This directory never uses clinical client records.</p>
        </div>
        <Button asChild variant="outline"><Link to="/crm/business-development/status">System status</Link></Button>
      </div>

      <Card>
        <CardHeader><CardTitle>Directory filters</CardTitle><CardDescription>Filter state is saved in this page URL and can be shared safely within CRM.</CardDescription></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-2"><Label htmlFor="organization-search">Search</Label><div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input id="organization-search" className="pl-9" value={filters.search ?? ''} onChange={(event) => set('q', event.target.value)} placeholder="Name or website" /></div></div>
          {textFilters.map(([id, label, key, placeholder]) => <div className="space-y-2" key={id}><Label htmlFor={id}>{label}</Label><Input id={id} value={searchParamsValue(filters, key) ?? ''} onChange={(event) => set(key, event.target.value)} placeholder={placeholder} /></div>)}
          {booleanFilters.map(([key, label]) => <div className="space-y-2" key={key}><Label htmlFor={`organization-${key}`}>{label}</Label><select id={`organization-${key}`} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={searchParamsValue(filters, key) ?? ''} onChange={(event) => set(key, event.target.value)}><option value="">Any</option><option value="true">Yes</option><option value="false">No</option></select></div>)}
          <div className="space-y-2"><Label htmlFor="organization-contacted">Contact history</Label><select id="organization-contacted" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={filters.contacted ?? ''} onChange={(event) => set('contacted', event.target.value)}><option value="">Any</option><option value="recently">Recently contacted</option><option value="never">Never contacted</option></select></div>
          <div className="space-y-2"><Label htmlFor="organization-sort">Sort</Label><select id="organization-sort" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={`${filters.sortBy}:${filters.sortDirection}`} onChange={(event) => { const [sortBy, sortDirection] = event.target.value.split(':'); setMany({ sortBy, sortDirection }); }}><option value="name:asc">Name, A–Z</option><option value="name:desc">Name, Z–A</option><option value="updatedAt:desc">Recently updated</option><option value="nextActionDueAt:asc">Next action due</option></select></div>
          <div className="flex items-end gap-3"><Button type="button" variant="outline" onClick={reset}><RotateCcw className="mr-2 h-4 w-4" />Reset filters</Button><p className="pb-2 text-sm text-muted-foreground">{selectedIds.length} selected</p></div>
        </CardContent>
      </Card>

      <RelationshipCapabilityState state={capability} isLoading={capabilityLoading} isError={capabilityError} onRetry={() => { void refetch(); }} />

      {available && directory.isLoading && <Card aria-label="Loading organizations"><CardHeader><Skeleton className="h-6 w-48" /><Skeleton className="h-4 w-full" /></CardHeader></Card>}
      {available && directory.isError && <Card><CardHeader><CardTitle>Organizations could not be loaded</CardTitle><CardDescription>Try again later. No clinical data was used as a fallback.</CardDescription></CardHeader><CardContent><Button variant="outline" onClick={() => { void directory.refetch(); }}>Try again</Button></CardContent></Card>}
      {available && directory.data && <Card>
        <CardHeader><CardTitle>Organization results</CardTitle><CardDescription>{directory.data.total} matching relationship organizations.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {items.length === 0 ? <p className="text-sm text-muted-foreground">No organizations match the current filters.</p> : <div className="divide-y rounded border">{items.map((organization) => <div className="flex items-center gap-3 p-3" key={organization.id}><Checkbox aria-label={`Select ${organization.name}`} checked={selectedIds.includes(organization.id)} onCheckedChange={(checked) => toggleSelected(organization.id, checked === true)} /><div className="min-w-0"><Link className="font-medium text-primary underline-offset-4 hover:underline" to={`/crm/business-development/organizations/${organization.id}`}>{organization.name}</Link><p className="truncate text-sm text-muted-foreground">{organization.type ?? 'Organization type not recorded'} · {organization.stage}</p></div></div>)}</div>}
          <RelationshipPagination page={directory.data.page} pageSize={directory.data.pageSize} total={directory.data.total} onPageChange={(page) => set('page', String(page))} />
        </CardContent>
      </Card>}

      {!available && !capabilityLoading && !capabilityError && <Card><CardHeader><Building2 className="mb-2 h-5 w-5 text-primary" /><CardTitle>Directory ready for database support</CardTitle><CardDescription>Filters and navigation are available, but organization results and selection remain unavailable until the typed relationship database capability is installed.</CardDescription></CardHeader></Card>}
    </div>
  );
}

function searchParamsValue(filters: ReturnType<typeof useOrganizationDirectoryFilters>['filters'], key: string) {
  const map: Record<string, unknown> = {
    stage: filters.stages?.[0], reviewStatus: filters.reviewStatuses?.[0], outreachStatus: filters.outreachStatuses?.[0], organizationType: filters.organizationTypes?.[0], owner: filters.ownerIds?.[0], roleCode: filters.roleCodes?.[0], initiative: filters.initiatives?.[0], state: filters.states?.[0], referralCategory: filters.referralCategories?.[0], opportunityStatus: filters.opportunityStatuses?.[0], veteranAffiliation: filters.veteranAffiliation, hasSocialPresence: filters.hasSocialPresence, overdue: filters.overdueNextAction, doNotContact: filters.doNotContact,
  };
  const value = map[key];
  return typeof value === 'boolean' ? String(value) : typeof value === 'string' ? value : undefined;
}
