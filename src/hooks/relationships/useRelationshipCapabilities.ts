import { useCrmAuth } from '@/hooks/crm/useCrmAuth';
import { useQuery } from '@tanstack/react-query';
import { createRelationshipCapabilityAdapter } from '@/services/relationships/capability-adapter';
import { dataProvider } from '@/services/dataProvider';
import type { Capability } from '@/domain/relationships/contracts';

const capabilityAdapter = createRelationshipCapabilityAdapter(dataProvider.relationships);

/** One cached capability snapshot for every relationship workspace. */
export function useRelationshipCapabilities() {
  const { currentTenantId, userId, crmRole, isAuthenticated } = useCrmAuth();
  return useQuery({
    queryKey: ['relationship-capabilities', currentTenantId, userId, crmRole],
    queryFn: () => capabilityAdapter.all(),
    enabled: isAuthenticated && Boolean(currentTenantId),
    staleTime: 60_000,
    retry: false,
  });
}

export function useRelationshipCapability(capability: Capability) {
  const query = useRelationshipCapabilities();
  return { ...query, capability: query.isSuccess ? query.data?.find(state => state.capability === capability) : undefined };
}
