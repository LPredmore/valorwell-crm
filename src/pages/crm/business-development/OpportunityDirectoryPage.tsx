import { useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RelationshipCapabilityState } from '@/components/crm/relationships/RelationshipCapabilityState';
import type { OpportunityStatus } from '@/domain/relationships/contracts';
import { opportunityStatuses, opportunityStatusLabel } from '@/domain/relationships/opportunity-workflow';
import { useRelationshipCapability } from '@/hooks/relationships/useRelationshipCapabilities';
import { dataProvider } from '@/services/dataProvider';

export default function OpportunityDirectoryPage() {
  const { capability, isLoading, isError, refetch } = useRelationshipCapability('opportunities');
  const available = capability?.available === true;
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<OpportunityStatus | ''>('');
  const [causeArea, setCauseArea] = useState('');
  const [veteranPriority, setVeteranPriority] = useState(false);
  const [page, setPage] = useState(1);

  const opportunities = useQuery({
    queryKey: ['relationship-opportunity-directory', search, status, causeArea, veteranPriority, page],
    queryFn: () => dataProvider.relationships.listOpportunities({
      search: search.trim() || undefined,
      statuses: status ? [status] : undefined,
      causeAreas: causeArea.trim() ? [causeArea.trim()] : undefined,
      veteranPriority: veteranPriority ? true : undefined,
      page,
      pageSize: 25,
      sortBy: 'updatedAt',
      sortDirection: 'desc',
    }),
    enabled: available,
    retry: false,
  });

  const organizationIds = useMemo(
    () => [...new Set(opportunities.data?.items.map((item) => item.organizationId) ?? [])],
    [opportunities.data],
  );
  const contactIds = useMemo(
    () => [...new Set(opportunities.data?.items.flatMap((item) => item.primaryContactId ? [item.primaryContactId] : []) ?? [])],
    [opportunities.data],
  );

  const organizationQueries = useQueries({
    queries: organizationIds.map((id) => ({
      queryKey: ['relationship-organization', id],
      queryFn: () => dataProvider.relationships.getOrganization(id),
      enabled: available,
      retry: false,
    })),
  });
  const contactQueries = useQueries({
    queries: contactIds.map((id) => ({
      queryKey: ['relationship-contact', id],
      queryFn: () => dataProvider.relationships.getContact(id),
      enabled: available,
      retry: false,
    })),
  });

  const organizationNames = new Map(organizationQueries.flatMap((query) => query.data ? [[query.data.id, query.data.name] as const] : []));
  const contactNames = new Map(contactQueries.flatMap((query) => query.data ? [[query.data.id, query.data.displayName] as const] : []));
  const totalPages = Math.max(1, Math.ceil((opportunities.data?.total ?? 0) / 25));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">BTY opportunities</h1>
          <p className="mt-2 text-muted-foreground">Non-clinical opportunity pipeline for Beyond The Yellow and Business Development relationships.</p>
        </div>
        <div className="flex gap-2">
          <Button asChild><Link to="/crm/business-development/organizations">Create from organization</Link></Button>
          <Button asChild variant="outline"><Link to="/crm/business-development/status">System status</Link></Button>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Opportunity filters</CardTitle><CardDescription>Search and filter the authoritative opportunity pipeline.</CardDescription></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <div className="space-y-2"><Label htmlFor="opportunity-search">Search</Label><Input id="opportunity-search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Organization, next action, or cause area" /></div>
          <div className="space-y-2"><Label htmlFor="opportunity-status">Status</Label><select id="opportunity-status" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={status} onChange={(event) => { setStatus(event.target.value as OpportunityStatus | ''); setPage(1); }}><option value="">All statuses</option>{opportunityStatuses.map((value) => <option key={value} value={value}>{opportunityStatusLabel(value)}</option>)}</select></div>
          <div className="space-y-2"><Label htmlFor="opportunity-cause">Cause area</Label><Input id="opportunity-cause" value={causeArea} onChange={(event) => { setCauseArea(event.target.value); setPage(1); }} placeholder="Exact cause area" /></div>
          <label className="flex items-center gap-2 self-end rounded-md border p-3 text-sm"><input type="checkbox" checked={veteranPriority} onChange={(event) => { setVeteranPriority(event.target.checked); setPage(1); }} />Veteran priority only</label>
        </CardContent>
      </Card>

      <RelationshipCapabilityState state={capability} isLoading={isLoading} isError={isError} onRetry={() => { void refetch(); }} />

      <Card>
        <CardHeader><CardTitle>Opportunity results</CardTitle><CardDescription>{opportunities.data ? `${opportunities.data.total} opportunity records` : 'Loading the typed opportunities adapter.'}</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {opportunities.isLoading && <p className="text-sm text-muted-foreground">Loading opportunities…</p>}
          {opportunities.isError && <p className="text-sm text-destructive">{opportunities.error instanceof Error ? opportunities.error.message : 'Opportunities could not be loaded.'}</p>}
          {opportunities.data?.items.length === 0 && <p className="text-sm text-muted-foreground">No opportunities match these filters.</p>}
          {opportunities.data?.items.map((opportunity) => (
            <div className="flex flex-wrap items-start justify-between gap-4 rounded-lg border p-4" key={opportunity.id}>
              <div>
                <Link className="font-semibold text-primary underline-offset-4 hover:underline" to={`/crm/business-development/opportunities/${opportunity.id}`}>
                  {organizationNames.get(opportunity.organizationId) ?? opportunity.causeArea ?? 'Opportunity detail'}
                </Link>
                <p className="mt-1 text-sm text-muted-foreground">{opportunity.causeArea ?? 'Cause area not recorded'} · {opportunity.primaryContactId ? contactNames.get(opportunity.primaryContactId) ?? 'Primary contact' : 'No primary contact'}</p>
                <p className="mt-2 text-sm">{opportunity.nextAction ?? 'No next action recorded'}</p>
                <p className="text-xs text-muted-foreground">Due: {formatDate(opportunity.nextActionDueAt)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">{opportunityStatusLabel(opportunity.status)}</Badge>
                {opportunity.veteranPriority && <Badge variant="outline">Veteran priority</Badge>}
              </div>
            </div>
          ))}
          {opportunities.data && opportunities.data.total > 25 && (
            <div className="flex items-center justify-between pt-3">
              <Button variant="outline" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</Button>
              <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
              <Button variant="outline" disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>Next</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString() : 'Not scheduled';
}
