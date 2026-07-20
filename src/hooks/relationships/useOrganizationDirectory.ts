import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { dataProvider } from '@/services/dataProvider';
import type {
  RelationshipOrganizationFilters,
  RelationshipOutreachStatus,
} from '@/domain/relationships/records';
import type { SortDirection } from '@/domain/relationships/contracts';

const pageSize = 25;

function numberParam(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function values(searchParams: URLSearchParams, key: string) {
  return searchParams.getAll(key).filter(Boolean);
}

function booleanParam(value: string | null) {
  return value === 'true' ? true : value === 'false' ? false : undefined;
}

/** URL-backed organization filters. No relationship record is persisted in browser storage. */
export function useOrganizationDirectoryFilters() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters: RelationshipOrganizationFilters = {
    search: searchParams.get('q') || undefined,
    outreachStatuses: values(searchParams, 'outreachStatus') as RelationshipOutreachStatus[],
    organizationKinds: values(searchParams, 'organizationKind'),
    veteranAffiliated: booleanParam(searchParams.get('veteranAffiliated')),
    ownerIds: values(searchParams, 'owner'),
    overdueNextAction: booleanParam(searchParams.get('overdue')),
    doNotContact: booleanParam(searchParams.get('doNotContact')),
    contacted: (searchParams.get('contacted') || undefined) as RelationshipOrganizationFilters['contacted'],
    page: numberParam(searchParams.get('page'), 1),
    pageSize,
    sortBy: (searchParams.get('sortBy') || 'name') as RelationshipOrganizationFilters['sortBy'],
    sortDirection: (searchParams.get('sortDirection') || 'asc') as SortDirection,
  };

  const set = (key: string, value?: string) => setSearchParams((current) => {
    const next = new URLSearchParams(current);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== 'page') next.delete('page');
    return next;
  });

  const setMany = (newValues: Record<string, string | undefined>) => setSearchParams((current) => {
    const next = new URLSearchParams(current);
    for (const [key, value] of Object.entries(newValues)) {
      if (value) next.set(key, value); else next.delete(key);
    }
    next.delete('page');
    return next;
  });

  const reset = () => setSearchParams({});
  return { filters, searchParams, set, setMany, reset };
}

/** Query is enabled only after the typed organization capability is available. */
export function useOrganizationDirectory(filters: RelationshipOrganizationFilters, enabled: boolean) {
  return useQuery({
    queryKey: ['relationship-organizations', filters],
    queryFn: () => dataProvider.relationships.listOrganizations(filters),
    enabled,
    retry: false,
  });
}
