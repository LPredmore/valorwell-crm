import { directoryEnum, directoryIds, directoryValues } from '@/domain/relationships/directory-url';
import { relationshipStages } from '@/domain/relationships/contracts';
import { relationshipOutreachStatuses, veteranAffiliationValues } from '@/domain/relationships/records';
import { useCrmAuth } from '@/hooks/crm/useCrmAuth';
import { useDebouncedDirectorySearch } from '@/hooks/relationships/useDebouncedDirectorySearch';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import type {
  RelationshipContactFilters,
} from '@/domain/relationships/records';
import { dataProvider } from '@/services/dataProvider';

const pageSize = 25;

function numberParam(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 1000000 ? parsed : fallback;
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
    organizationIds: directoryIds(searchParams, 'organization'),
    roleTitle: searchParams.get('roleTitle') || undefined,
    overdueNextAction: booleanParam(searchParams.get('overdue')),
    ownerIds: directoryIds(searchParams, 'owner'),
    sources: values(searchParams, 'source'),
    stages: directoryValues(searchParams, 'stage', relationshipStages),
    lastContactWithinDays: [30, 90, 365].includes(Number(searchParams.get('contactDays')))
      ? Number(searchParams.get('contactDays')) : undefined,
    outreachStatuses: directoryValues(searchParams, 'outreachStatus', relationshipOutreachStatuses),
    veteranAffiliations: directoryValues(searchParams, 'veteranAffiliation', veteranAffiliationValues),
    doNotContact: booleanParam(searchParams.get('doNotContact')),
    hasNextAction: booleanParam(searchParams.get('hasNextAction')),
    page: numberParam(searchParams.get('page'), 1),
    pageSize,
    sortBy: directoryEnum(searchParams.get('sortBy'), ['displayName', 'updatedAt', 'nextActionDueAt'] as const, 'displayName'),
    sortDirection: directoryEnum(searchParams.get('sortDirection'), ['asc', 'desc'] as const, 'asc'),
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

export function useContactDirectory(filters: RelationshipContactFilters, enabled: boolean) {
  const { currentTenantId, userId, crmRole, isAuthenticated } = useCrmAuth();
  const search = useDebouncedDirectorySearch(filters.search);
  const roleTitle = useDebouncedDirectorySearch(filters.roleTitle);
  const queryFilters = { ...filters, search, roleTitle, };
  const query = useQuery({
    queryKey: ['relationship-contacts', currentTenantId, userId, crmRole, queryFilters],
    queryFn: () => dataProvider.relationships.listContacts(queryFilters),
    enabled: enabled && isAuthenticated && Boolean(currentTenantId),
    retry: false,
  });
  return { ...query, isSearchPending: search !== (filters.search ?? '') || roleTitle !== (filters.roleTitle ?? '') };
}
