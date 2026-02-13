import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

interface BulkUpdateTagParams {
  clientIds: string[];
  tag: string | null;
}

export function useBulkUpdateTag() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ clientIds, tag }: BulkUpdateTagParams) => {
      let successCount = 0;
      let failCount = 0;

      await Promise.all(
        clientIds.map(async (id) => {
          try {
            const { error } = await supabase
              .from('clients')
              .update({ tags: tag } as any)
              .eq('id', id);

            if (error) throw error;
            successCount++;
          } catch (err) {
            console.error(`Failed to update tag for client ${id}:`, err);
            failCount++;
          }
        })
      );

      return { successCount, failCount };
    },
    onSuccess: ({ successCount, failCount }) => {
      queryClient.invalidateQueries({ queryKey: ['crm-clients'] });
      queryClient.invalidateQueries({ queryKey: ['crm-tag-options'] });
      toast({
        title: 'Tags updated',
        description:
          failCount === 0
            ? `${successCount} client${successCount !== 1 ? 's' : ''} updated.`
            : `${successCount} updated, ${failCount} failed.`,
        variant: failCount > 0 ? 'destructive' : undefined,
      });
    },
    onError: (error) => {
      console.error('Bulk tag update failed:', error);
      toast({ title: 'Error', description: 'Failed to update tags.', variant: 'destructive' });
    },
  });
}
