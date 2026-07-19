import { useQuery } from '@tanstack/react-query';
import { createRelationshipCapabilityAdapter } from '@/services/relationships/capability-adapter';
import { dataProvider } from '@/services/dataProvider';
import type { Capability } from '@/domain/relationships/contracts';

const capabilityAdapter = createRelationshipCapabilityAdapter(dataProvider.relationships);

/** One cached capability snapshot for every relationship workspace. */
export function useRelationshipCapabilities() {
  return useQuery({
    queryKey: ['relationship-capabilities'],
    queryFn: () => capabilityAdapter.all(),
    staleTime: Infinity,
    retry: false,
  });
}

export function useRelationshipCapability(capability: Capability) {
  const query = useRelationshipCapabilities();
  return { ...query, capability: query.data?.find(state => state.capability === capability) };
}
