import { useQuery } from '@tanstack/react-query';
import {
  RELATIONSHIP_DOMAIN_KEY,
  type RelationshipArchitectureContract,
} from '@/lib/crm/relationship-architecture';

export function useRelationshipArchitecture() {
  return useQuery({
    queryKey: ['crm-domain-contract', RELATIONSHIP_DOMAIN_KEY],
    // crm_domain_contracts is intentionally not in the current generated schema.
    // Do not probe an unavailable table: the status page presents the typed local
    // boundary until the database team adds a supported repository adapter.
    queryFn: async (): Promise<RelationshipArchitectureContract> => { throw new Error('Capability not yet installed'); },
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}
