import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { dataProvider } from '@/services/dataProvider';
import type { ListClientsQuery } from '@/repositories/types';
import { useCrmAuth } from '@/hooks/crm/useCrmAuth';
import type {
  LifecycleStage, EngagementState, EligibilityState,
  ContactPolicy, ServicePolicy, CareCadence, RiskState, ClosureInfo,
} from '@/domain/canonical';

export const clientKeys = {
  all: ['canonical-clients'] as const,
  list: (tenantId: string | null, q: ListClientsQuery) => ['canonical-clients', tenantId, 'list', q] as const,
  one: (tenantId: string | null, id: string) => ['canonical-clients', tenantId, 'one', id] as const,
};

export function useCanonicalClients(query: ListClientsQuery = {}) {
  const { currentTenantId, isAuthenticated, isLoading } = useCrmAuth();
  return useQuery({
    queryKey: clientKeys.list(currentTenantId, query),
    queryFn: () => {
      if (!currentTenantId) throw new Error('Current CRM operating tenant is required');
      return dataProvider.clients.list(currentTenantId, query);
    },
    enabled: !isLoading && isAuthenticated && !!currentTenantId,
  });
}

export function useCanonicalClient(id?: string) {
  const { currentTenantId, isAuthenticated, isLoading } = useCrmAuth();
  return useQuery({
    queryKey: clientKeys.one(currentTenantId, id ?? ''),
    queryFn: () => (id && currentTenantId ? dataProvider.clients.get(currentTenantId, id) : Promise.resolve(null)),
    enabled: !isLoading && isAuthenticated && !!currentTenantId && !!id,
  });
}

export function useClientMutations(id: string) {
  const qc = useQueryClient();
  const { currentTenantId } = useCrmAuth();
  const tenantId = () => {
    if (!currentTenantId) throw new Error('Current CRM operating tenant is required');
    return currentTenantId;
  };
  const invalidate = () => qc.invalidateQueries({ queryKey: ['canonical-clients'] });

  return {
    updateLifecycle: useMutation({
      mutationFn: (p: { next: LifecycleStage; reason: string; note?: string }) =>
        dataProvider.clients.updateLifecycle(tenantId(), id, p.next, p.reason, p.note),
      onSuccess: invalidate,
    }),
    updateEngagement: useMutation({
      mutationFn: (next: EngagementState) => dataProvider.clients.updateEngagement(tenantId(), id, next),
      onSuccess: invalidate,
    }),
    updateEligibility: useMutation({
      mutationFn: (p: {
        next: EligibilityState;
        note?: string;
        manualReview?: { owner: string; next_action: string; review_due_at: string } | null;
      }) =>
        dataProvider.clients.updateEligibility(tenantId(), id, p.next, p.note, p.manualReview ?? null),
      onSuccess: invalidate,
    }),
    updateContactPolicy: useMutation({
      mutationFn: (p: { next: ContactPolicy; reason: string }) =>
        dataProvider.clients.updateContactPolicy(tenantId(), id, p.next, p.reason),
      onSuccess: invalidate,
    }),
    updateServicePolicy: useMutation({
      mutationFn: (p: { next: ServicePolicy; reason: string }) =>
        dataProvider.clients.updateServicePolicy(tenantId(), id, p.next, p.reason),
      onSuccess: invalidate,
    }),
    updateCareCadence: useMutation({
      mutationFn: (next: CareCadence) => dataProvider.clients.updateCareCadence(tenantId(), id, next),
      onSuccess: invalidate,
    }),
    updateRisk: useMutation({
      mutationFn: (next: RiskState) => dataProvider.clients.updateRisk(tenantId(), id, next),
      onSuccess: invalidate,
    }),
    close: useMutation({
      mutationFn: (info: ClosureInfo) => dataProvider.clients.close(tenantId(), id, info),
      onSuccess: invalidate,
    }),
    reopen: useMutation({
      mutationFn: (reason: string) => dataProvider.clients.reopen(tenantId(), id, reason),
      onSuccess: invalidate,
    }),
    assignClinician: useMutation({
      mutationFn: (p: { staffId: string; reason: string }) =>
        dataProvider.clients.assignClinician(tenantId(), id, p.staffId, p.reason),
      onSuccess: invalidate,
    }),
    assignOperationsOwner: useMutation({
      mutationFn: (staffId: string | null) => dataProvider.clients.assignOperationsOwner(tenantId(), id, staffId),
      onSuccess: invalidate,
    }),
  };
}
