import { useQuery } from '@tanstack/react-query';
import { helpscoutApi } from '@/lib/crm/helpscout-api';
import { HelpScoutConversationDetail } from '@/lib/crm/types';

interface UseConversationDetailOptions {
  conversationId: number | null;
  enabled?: boolean;
}

export function useConversationDetail(options: UseConversationDetailOptions) {
  const { conversationId, enabled = true } = options;

  return useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: async () => {
      if (!conversationId) throw new Error('No conversation ID');
      
      const response = await helpscoutApi<HelpScoutConversationDetail>('get-conversation', {
        params: {
          id: String(conversationId),
        },
      });
      return response;
    },
    enabled: enabled && conversationId !== null,
    staleTime: 30000,
  });
}
