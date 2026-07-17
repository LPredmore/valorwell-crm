import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { dataProvider } from '@/services/dataProvider';
import type { ListClientsQuery } from '@/repositories/types';
import type {
  LifecycleStage, EngagementState, EligibilityState,
  ContactPolicy, ServicePolicy, CareCadence, RiskState, ClosureInfo,
} from '@/domain/canonical';

export const clientKeys = {
  all: ['canonical-clients'] as const,
  list: (q: ListClientsQuery) => ['canonical-clients', 'list', q] as const,
  one: (id: string) => ['canonical-clients', 'one', id] as const,
};

export function useCanonicalClients(query: ListClientsQuery = {}) {
  return useQuery({
    queryKey: clientKeys.list(query),
    queryFn: () => dataProvider.clients.list(query),
  });
}

export function useCanonicalClient(id?: string) {
  return useQuery({
    queryKey: clientKeys.one(id ?? ''),
    queryFn: () => (id ? dataProvider.clients.get(id) : Promise.resolve(null)),
    enabled: !!id,
  });
}

export function useClientMutations(id: string) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['canonical-clients'] });

  return {
    updateLifecycle: useMutation({
      mutationFn: (p: { next: LifecycleStage; reason: string; note?: string }) =>
        dataProvider.clients.updateLifecycle(id, p.next, p.reason, p.note),
      onSuccess: invalidate,
    }),
    updateEngagement: useMutation({
      mutationFn: (next: EngagementState) => dataProvider.clients.updateEngagement(id, next),
      onSuccess: invalidate,
    }),
    updateEligibility: useMutation({
      mutationFn: (p: {
        next: EligibilityState;
        note?: string;
        manualReview?: { owner: string; next_action: string; review_due_at: string } | null;
      }) =>
        dataProvider.clients.updateEligibility(id, p.next, p.note, p.manualReview ?? null),
      onSuccess: invalidate,
    }),
    updateContactPolicy: useMutation({
      mutationFn: (p: { next: ContactPolicy; reason: string }) =>
        dataProvider.clients.updateContactPolicy(id, p.next, p.reason),
      onSuccess: invalidate,
    }),
    updateServicePolicy: useMutation({
      mutationFn: (p: { next: ServicePolicy; reason: string }) =>
        dataProvider.clients.updateServicePolicy(id, p.next, p.reason),
      onSuccess: invalidate,
    }),
    updateCareCadence: useMutation({
      mutationFn: (next: CareCadence) => dataProvider.clients.updateCareCadence(id, next),
      onSuccess: invalidate,
    }),
    updateRisk: useMutation({
      mutationFn: (next: RiskState) => dataProvider.clients.updateRisk(id, next),
      onSuccess: invalidate,
    }),
    close: useMutation({
      mutationFn: (info: ClosureInfo) => dataProvider.clients.close(id, info),
      onSuccess: invalidate,
    }),
    reopen: useMutation({
      mutationFn: (reason: string) => dataProvider.clients.reopen(id, reason),
      onSuccess: invalidate,
    }),
    assignClinician: useMutation({
      mutationFn: (p: { staffId: string; reason: string }) =>
        dataProvider.clients.assignClinician(id, p.staffId, p.reason),
      onSuccess: invalidate,
    }),
    assignOperationsOwner: useMutation({
      mutationFn: (staffId: string | null) => dataProvider.clients.assignOperationsOwner(id, staffId),
      onSuccess: invalidate,
    }),
  };
}
