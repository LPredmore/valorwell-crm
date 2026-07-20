import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { dataProvider } from '@/services/dataProvider';
import type { CampaignFilters, RelationshipCampaignStatus, SortDirection } from '@/domain/relationships/contracts';

const pageSize = 25;

function numberParam(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function values(searchParams: URLSearchParams, key: string) {
  return searchParams.getAll(key).filter(Boolean);
}

export function useRelationshipCampaignDirectoryFilters() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters: CampaignFilters = {
    search: searchParams.get('q') || undefined,
    statuses: values(searchParams, 'status').map((value) => value as RelationshipCampaignStatus),
    ownerIds: values(searchParams, 'owner'),
    initiatives: values(searchParams, 'initiative'),
    page: numberParam(searchParams.get('page'), 1),
    pageSize,
    sortBy: (searchParams.get('sortBy') || 'updatedAt') as CampaignFilters['sortBy'],
    sortDirection: (searchParams.get('sortDirection') || 'desc') as SortDirection,
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
  return { filters, set, setMany, reset };
}

export function useRelationshipCampaignDirectory(filters: CampaignFilters, enabled: boolean) {
  return useQuery({
    queryKey: ['relationship-campaigns', filters],
    queryFn: () => dataProvider.relationships.listCampaigns(filters),
    enabled,
    retry: false,
  });
}
