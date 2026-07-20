import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { dataProvider } from '@/services/dataProvider';
import type { OrganizationFilters, SortDirection } from '@/domain/relationships/contracts';

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
  const filters: OrganizationFilters = {
    search: searchParams.get('q') || undefined,
    stages: values(searchParams, 'stage') as OrganizationFilters['stages'],
    reviewStatuses: values(searchParams, 'reviewStatus'),
    outreachStatuses: values(searchParams, 'outreachStatus'),
    organizationTypes: values(searchParams, 'organizationType'),
    veteranAffiliation: booleanParam(searchParams.get('veteranAffiliation')),
    ownerIds: values(searchParams, 'owner'),
    roleCodes: values(searchParams, 'roleCode'),
    initiatives: values(searchParams, 'initiative'),
    states: values(searchParams, 'state'),
    hasSocialPresence: booleanParam(searchParams.get('hasSocialPresence')),
    overdueNextAction: booleanParam(searchParams.get('overdue')),
    doNotContact: booleanParam(searchParams.get('doNotContact')),
    referralCategories: values(searchParams, 'referralCategory'),
    opportunityStatuses: values(searchParams, 'opportunityStatus') as OrganizationFilters['opportunityStatuses'],
    contacted: (searchParams.get('contacted') || undefined) as OrganizationFilters['contacted'],
    page: numberParam(searchParams.get('page'), 1),
    pageSize,
    sortBy: (searchParams.get('sortBy') || 'name') as OrganizationFilters['sortBy'],
    sortDirection: (searchParams.get('sortDirection') || 'asc') as SortDirection,
  };

  const set = (key: string, value?: string) => setSearchParams((current) => {
    const next = new URLSearchParams(current);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== 'page') next.delete('page');
    return next;
  });

  const setMany = (values: Record<string, string | undefined>) => setSearchParams((current) => {
    const next = new URLSearchParams(current);
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value); else next.delete(key);
    }
    next.delete('page');
    return next;
  });

  const reset = () => setSearchParams({});
  return { filters, searchParams, set, setMany, reset };
}

/** Query is enabled only after the typed organization capability is available. */
export function useOrganizationDirectory(filters: OrganizationFilters, enabled: boolean) {
  return useQuery({
    queryKey: ['relationship-organizations', filters],
    queryFn: () => dataProvider.relationships.listOrganizations(filters),
    enabled,
    retry: false,
  });
}
