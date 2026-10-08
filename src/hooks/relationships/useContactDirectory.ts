import { useDebouncedDirectorySearch } from '@/hooks/relationships/useDebouncedDirectorySearch';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import type {
  RelationshipContactFilters,
  RelationshipOutreachStatus,
  VeteranAffiliation,
} from '@/domain/relationships/records';
import type { SortDirection } from '@/domain/relationships/contracts';
import { dataProvider } from '@/services/dataProvider';

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

export function useContactDirectoryFilters() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters: RelationshipContactFilters = {
    search: searchParams.get('q') || undefined,
    organizationIds: values(searchParams, 'organization'),
    roleTitle: searchParams.get('roleTitle') || undefined,
    overdueNextAction: booleanParam(searchParams.get('overdue')),
    ownerIds: values(searchParams, 'owner'),
    sources: values(searchParams, 'source'),
    stages: values(searchParams, 'stage') as RelationshipContactFilters['stages'],
    lastContactWithinDays: [30, 90, 365].includes(Number(searchParams.get('contactDays')))
      ? Number(searchParams.get('contactDays')) : undefined,
    outreachStatuses: values(searchParams, 'outreachStatus') as RelationshipOutreachStatus[],
    veteranAffiliations: values(searchParams, 'veteranAffiliation') as VeteranAffiliation[],
    doNotContact: booleanParam(searchParams.get('doNotContact')),
    hasNextAction: booleanParam(searchParams.get('hasNextAction')),
    page: numberParam(searchParams.get('page'), 1),
    pageSize,
    sortBy: (searchParams.get('sortBy') || 'displayName') as RelationshipContactFilters['sortBy'],
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
  return { filters, set, setMany, reset };
}

export function useContactDirectory(filters: RelationshipContactFilters, enabled: boolean) {
  const search = useDebouncedDirectorySearch(filters.search);
  const roleTitle = useDebouncedDirectorySearch(filters.roleTitle);
  const queryFilters = { ...filters, search, roleTitle, };
  return useQuery({
    queryKey: ['relationship-contacts', queryFilters],
    queryFn: () => dataProvider.relationships.listContacts(queryFilters),
    enabled,
    retry: false,
  });
}
