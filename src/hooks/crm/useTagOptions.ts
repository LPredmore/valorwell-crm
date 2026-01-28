import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCrmAuth } from './useCrmAuth';

export function useTagOptions() {
  const { tenantId, isAuthenticated } = useCrmAuth();

  return useQuery({
    queryKey: ['crm-tag-options', tenantId],
    queryFn: async (): Promise<string[]> => {
      // Fetch distinct non-null tags from clients
      const { data, error } = await supabase
        .from('clients')
        .select('tags')
        .eq('tenant_id', tenantId)
        .not('tags', 'is', null);

      if (error) {
        console.error('Error fetching tag options:', error);
        throw error;
      }

      // Extract unique tags
      const uniqueTags = new Set<string>();
      data?.forEach(client => {
        if (client.tags && typeof client.tags === 'string') {
          uniqueTags.add(client.tags);
        }
      });

      return Array.from(uniqueTags).sort();
    },
    enabled: isAuthenticated && !!tenantId,
  });
}
