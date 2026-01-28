import { useQuery } from '@tanstack/react-query';
import { helpscoutApi } from '@/lib/crm/helpscout-api';
import { ConversationsResponse } from '@/lib/crm/types';

interface UseConversationsOptions {
  status?: 'all' | 'active' | 'pending' | 'closed';
  page?: number;
  enabled?: boolean;
}

export function useConversations(options: UseConversationsOptions = {}) {
  const { status = 'all', page = 1, enabled = true } = options;

  return useQuery({
    queryKey: ['conversations', status, page],
    queryFn: async () => {
      const response = await helpscoutApi<ConversationsResponse>('list-conversations', {
        params: {
          status,
          page: String(page),
        },
      });
      return response;
    },
    enabled,
    refetchInterval: 30000, // Auto-refresh every 30 seconds for "live" feel
    staleTime: 10000, // Consider data stale after 10 seconds
  });
}
