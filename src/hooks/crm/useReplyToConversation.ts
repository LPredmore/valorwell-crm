import { useMutation, useQueryClient } from '@tanstack/react-query';
import { helpscoutApi } from '@/lib/crm/helpscout-api';
import { toast } from 'sonner';

interface ReplyParams {
  conversationId: number;
  text: string;
  status: 'active' | 'pending' | 'closed';
  clientId?: string;
}

export function useReplyToConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ conversationId, text, status, clientId }: ReplyParams) => {
      return helpscoutApi('reply', {
        params: { id: String(conversationId) },
        body: {
          text,
          status,
          clientId,
        },
      });
    },
    onSuccess: (_data, variables) => {
      toast.success('Reply sent successfully');
      // Invalidate conversation detail to refetch messages
      queryClient.invalidateQueries({
        queryKey: ['helpscout-conversation-detail', variables.conversationId],
      });
      // Also invalidate conversations list in case status changed
      queryClient.invalidateQueries({
        queryKey: ['helpscout-conversations'],
      });
    },
    onError: (error) => {
      console.error('Reply error:', error);
      toast.error('Failed to send reply');
    },
  });
}
