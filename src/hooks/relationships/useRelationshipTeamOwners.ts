import { useQuery } from '@tanstack/react-query';
import { useCrmAuth } from '@/hooks/crm/useCrmAuth';
import { listTeamOwners } from '@/repositories/supabase/pipeline-team-owners';

export function useRelationshipTeamOwners() {
  const { currentTenantId, userId, isAuthenticated } = useCrmAuth();
  return useQuery({
    queryKey: ['relationship-team-owners', currentTenantId, userId],
    queryFn: () => listTeamOwners(currentTenantId!),
    enabled: isAuthenticated && Boolean(currentTenantId),
    staleTime: 60_000,
    retry: false,
  });
}
