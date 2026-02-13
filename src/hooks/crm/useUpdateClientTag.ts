import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

interface UpdateClientTagParams {
  clientId: string;
  tag: string | null;
}

export function useUpdateClientTag() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ clientId, tag }: UpdateClientTagParams) => {
      const { error } = await supabase
        .from('clients')
        .update({ tags: tag } as any)
        .eq('id', clientId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-clients'] });
      queryClient.invalidateQueries({ queryKey: ['crm-client'] });
      queryClient.invalidateQueries({ queryKey: ['crm-tag-options'] });
      toast({ title: 'Tag updated' });
    },
    onError: (error) => {
      console.error('Failed to update tag:', error);
      toast({ title: 'Error', description: 'Failed to update tag.', variant: 'destructive' });
    },
  });
}
