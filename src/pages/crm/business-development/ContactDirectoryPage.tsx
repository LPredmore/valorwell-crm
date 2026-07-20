import { Link } from 'react-router-dom';
import { RotateCcw, Search, UsersRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RelationshipCapabilityState } from '@/components/crm/relationships/RelationshipCapabilityState';
import { RelationshipPagination } from '@/components/crm/relationships/RelationshipWorkspacePrimitives';
import { useRelationshipCapability } from '@/hooks/relationships/useRelationshipCapabilities';
import { useContactDirectory, useContactDirectoryFilters } from '@/hooks/relationships/useContactDirectory';

export default function ContactDirectoryPage() {
  const { capability, isLoading, isError, refetch } = useRelationshipCapability('contacts');
  const { filters, set, setMany, reset } = useContactDirectoryFilters();
  const available = capability?.available === true;
  const directory = useContactDirectory(filters, available);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-3xl font-bold tracking-tight">Relationship contacts</h1><p className="mt-2 text-muted-foreground">Named people and role inboxes stored separately from clinical clients.</p></div>
        <Button asChild variant="outline"><Link to="/crm/business-development/status">System status</Link></Button>
      </div>

      <Card>
        <CardHeader><CardTitle>Contact directory filters</CardTitle><CardDescription>Filters use only persisted contact and affiliation fields.</CardDescription></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-2"><Label htmlFor="contact-search">Search</Label><div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input id="contact-search" className="pl-9" value={filters.search ?? ''} onChange={(event) => set('q', event.target.value)} placeholder="Name, email, or phone" /></div></div>
          <Filter id="contact-organization" label="Organization ID" value={filters.organizationIds?.[0] ?? ''} onChange={(value) => set('organization', value)} placeholder="Organization UUID" />
          <Filter id="contact-owner" label="Assigned owner" value={filters.ownerIds?.[0] ?? ''} onChange={(value) => set('owner', value)} placeholder="Owner profile ID" />
          <Filter id="contact-outreach" label="Outreach status" value={filters.outreachStatuses?.[0] ?? ''} onChange={(value) => set('outreachStatus', value)} placeholder="e.g. contacted" />
          <Filter id="contact-veteran" label="Veteran affiliation" value={filters.veteranAffiliations?.[0] ?? ''} onChange={(value) => set('veteranAffiliation', value)} placeholder="e.g. veteran" />
          <BooleanFilter id="contact-dnc" label="Do not contact" value={filters.doNotContact} onChange={(value) => set('doNotContact', value)} />
          <BooleanFilter id="contact-next-action" label="Has next action" value={filters.hasNextAction} onChange={(value) => set('hasNextAction', value)} />
          <div className="space-y-2"><Label htmlFor="contact-sort">Sort</Label><select id="contact-sort" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={`${filters.sortBy}:${filters.sortDirection}`} onChange={(event) => { const [sortBy, sortDirection] = event.target.value.split(':'); setMany({ sortBy, sortDirection }); }}><option value="displayName:asc">Name, A–Z</option><option value="displayName:desc">Name, Z–A</option><option value="updatedAt:desc">Recently updated</option><option value="nextActionDueAt:asc">Next action due</option></select></div>
          <div className="flex items-end"><Button type="button" variant="outline" onClick={reset}><RotateCcw className="mr-2 h-4 w-4" />Reset filters</Button></div>
        </CardContent>
      </Card>

      <RelationshipCapabilityState state={capability} isLoading={isLoading} isError={isError} onRetry={() => { void refetch(); }} />

      {available && directory.isLoading && <Card><CardHeader><CardTitle>Loading contacts…</CardTitle></CardHeader></Card>}
      {available && directory.isError && <Card><CardHeader><CardTitle>Contacts could not be loaded</CardTitle><CardDescription>{directory.error instanceof Error ? directory.error.message : 'Unknown query error.'}</CardDescription></CardHeader><CardContent><Button variant="outline" onClick={() => { void directory.refetch(); }}>Try again</Button></CardContent></Card>}
      {available && directory.data && <Card>
        <CardHeader><CardTitle>Contact results</CardTitle><CardDescription>{directory.data.total} matching relationship contacts.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {directory.data.items.length === 0 ? <p className="text-sm text-muted-foreground">No contacts match the current filters.</p> : <div className="divide-y rounded border">{directory.data.items.map((contact) => <div className="flex flex-wrap items-center justify-between gap-3 p-3" key={contact.id}><div><div className="flex items-center gap-2"><p className="font-medium">{contact.displayName}</p><Badge variant="outline">{contact.kind.replace(/_/g, ' ')}</Badge></div><p className="text-sm text-muted-foreground">{contact.email ?? 'No email'}{contact.phone ? ` · ${contact.phone}` : ''}</p></div><div className="text-right"><p className="text-sm">{contact.outreachStatus.replace(/_/g, ' ')}</p><p className="text-xs text-muted-foreground">{contact.affiliations.length} affiliation{contact.affiliations.length === 1 ? '' : 's'}</p></div></div>)}</div>}
          <RelationshipPagination page={directory.data.page} pageSize={directory.data.pageSize} total={directory.data.total} onPageChange={(page) => set('page', String(page))} />
        </CardContent>
      </Card>}

      {!available && !isLoading && !isError && <Card><CardHeader><UsersRound className="mb-2 h-5 w-5 text-primary" /><CardTitle>Contact database access unavailable</CardTitle><CardDescription>{capability?.reason ?? 'The tenant-scoped contact capability could not be verified.'}</CardDescription></CardHeader></Card>}
    </div>
  );
}

function Filter({ id, label, value, onChange, placeholder }: { id: string; label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label><Input id={id} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></div>;
}

function BooleanFilter({ id, label, value, onChange }: { id: string; label: string; value?: boolean; onChange: (value: string) => void }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label><select id={id} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={value === undefined ? '' : String(value)} onChange={(event) => onChange(event.target.value)}><option value="">Any</option><option value="true">Yes</option><option value="false">No</option></select></div>;
}
