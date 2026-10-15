import type { OpportunityStatus } from './contracts';
import { opportunityStatuses } from './opportunity-workflow';

export function readOpportunityDirectory(params: URLSearchParams): { search: string; status: OpportunityStatus | ''; causeArea: string; veteranPriority: boolean; page: number } {
  const rawPage = Number(params.get('page'));
  return {
    search: (params.get('q') ?? '').slice(0, 200),
    status: opportunityStatuses.find(value => value === params.get('status')) ?? '',
    causeArea: (params.get('causeArea') ?? '').slice(0, 200),
    veteranPriority: params.get('veteranPriority') === 'true',
    page: Number.isSafeInteger(rawPage) && rawPage > 0 && rawPage <= 1_000_000 ? rawPage : 1,
  };
}

export function updateOpportunityDirectory(params: URLSearchParams, key: string, value: string) {
  const next = new URLSearchParams(params);
  if (value) next.set(key, value); else next.delete(key);
  if (key !== 'page') next.delete('page');
  return next;
}
