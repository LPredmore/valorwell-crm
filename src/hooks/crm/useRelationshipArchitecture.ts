import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  RELATIONSHIP_ARCHITECTURE_FALLBACK,
  RELATIONSHIP_DOMAIN_KEY,
  type RelationshipArchitectureContract,
} from '@/lib/crm/relationship-architecture';

type ContractQuery = {
  select: (columns: string) => ContractQuery;
  eq: (column: string, value: string) => ContractQuery;
  maybeSingle: () => Promise<{
    data: RelationshipArchitectureContract | null;
    error: { message: string } | null;
  }>;
};

type UntypedSupabase = {
  from: (table: string) => ContractQuery;
};

export function useRelationshipArchitecture() {
  return useQuery({
    queryKey: ['crm-domain-contract', RELATIONSHIP_DOMAIN_KEY],
    queryFn: async (): Promise<RelationshipArchitectureContract> => {
      const db = supabase as unknown as UntypedSupabase;
      const { data, error } = await db
        .from('crm_domain_contracts')
        .select(
          'domain_key, canonical_database, canonical_application, inbound_lane, outbound_lane, clinical_campaign_lane, clinical_campaign_boundary_enforced, implementation_status, terminology, effective_at',
        )
        .eq('domain_key', RELATIONSHIP_DOMAIN_KEY)
        .maybeSingle();

      if (error) throw new Error(error.message);
      return data ?? RELATIONSHIP_ARCHITECTURE_FALLBACK;
    },
    staleTime: 5 * 60 * 1000,
  });
}
