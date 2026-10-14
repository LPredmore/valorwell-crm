import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCrmAuth } from '@/hooks/crm/useCrmAuth';
import { useDebouncedDirectorySearch } from '@/hooks/relationships/useDebouncedDirectorySearch';
import { RelationshipPagination } from './RelationshipWorkspacePrimitives';
import { dataProvider } from '@/services/dataProvider';

export function RelationshipOrganizationFilter({ value, onChange, enabled }: {
  value: string; onChange: (value: string) => void; enabled: boolean;
}) {
  const { currentTenantId, userId, isAuthenticated } = useCrmAuth();
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedDirectorySearch(searchInput);
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [search, currentTenantId]);
  const available = enabled && isAuthenticated && Boolean(currentTenantId);
  const organizations = useQuery({
    queryKey: ['relationship-filter-organizations', currentTenantId, userId, search, page],
    queryFn: () => dataProvider.relationships.listOrganizations({ search, page, pageSize: 25, sortBy: 'name', sortDirection: 'asc' }),
    enabled: available, retry: false,
  });
  const selected = useQuery({
    queryKey: ['relationship-organization', currentTenantId, userId, value],
    queryFn: () => dataProvider.relationships.getOrganization(value),
    enabled: available && Boolean(value), retry: false,
  });
  const items = organizations.data?.items ?? [];
  return <div className="space-y-2">
    <Label htmlFor="contact-organization-search">Search organizations</Label>
    <Input id="contact-organization-search" value={searchInput} onChange={event => setSearchInput(event.target.value)} placeholder="Organization name or website" disabled={!available} />
    <Label htmlFor="contact-organization">Organization</Label>
    <select id="contact-organization" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      value={value} onChange={event => onChange(event.target.value)} disabled={!available}>
      <option value="">All organizations</option>
      {value && !items.some(item => item.id === value) && <option value={value}>{selected.data?.name ?? 'Selected organization'}</option>}
      {items.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
    </select>
    {organizations.isError && <p role="alert" className="text-xs text-destructive">Organization choices could not be loaded.</p>}
    {organizations.isLoading && <p role="status" className="text-xs text-muted-foreground">Loading organizations…</p>}
    {organizations.data && organizations.data.total > 25 && <RelationshipPagination page={page} pageSize={25} total={organizations.data.total} onPageChange={setPage} />}
  </div>;
}
