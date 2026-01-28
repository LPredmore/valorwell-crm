import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCrmAuth } from './useCrmAuth';
import type { PatStatus } from '@/lib/crm/types';

// Default statuses in recommended order
export const DEFAULT_KANBAN_STATUSES: PatStatus[] = [
  'Interested',
  'New',
  'No Insurance',
  'Manual Check',
  'Waitlist',
  'Matching',
  'Registered',
  'Unscheduled',
  'Scheduled',
  'Early Sessions',
  'Established',
  'Inactive',
  'Blacklisted',
  'DNC',
];

interface KanbanConfig {
  id: string;
  tenant_id: string;
  visible_statuses: PatStatus[];
  created_at: string;
  updated_at: string;
}

export function useKanbanConfig() {
  const { tenantId, isAuthenticated, role } = useCrmAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['crm-kanban-config', tenantId],
    queryFn: async (): Promise<KanbanConfig | null> => {
      const { data, error } = await supabase
        .from('crm_kanban_config')
        .select('*')
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (error) {
        console.error('Error fetching kanban config:', error);
        throw error;
      }

      return data as KanbanConfig | null;
    },
    enabled: isAuthenticated && !!tenantId,
  });

  // Get the visible statuses (from DB or default)
  const visibleStatuses: PatStatus[] = query.data?.visible_statuses 
    ? (query.data.visible_statuses as PatStatus[])
    : DEFAULT_KANBAN_STATUSES;

  const saveMutation = useMutation({
    mutationFn: async (newStatuses: PatStatus[]) => {
      if (query.data?.id) {
        // Update existing config
        const { error } = await supabase
          .from('crm_kanban_config')
          .update({ visible_statuses: newStatuses })
          .eq('id', query.data.id);
        
        if (error) throw error;
      } else {
        // Insert new config
        const { error } = await supabase
          .from('crm_kanban_config')
          .insert({
            tenant_id: tenantId,
            visible_statuses: newStatuses,
          });
        
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-kanban-config', tenantId] });
    },
  });

  return {
    config: query.data,
    visibleStatuses,
    isLoading: query.isLoading,
    isAdmin: role === 'admin',
    saveConfig: saveMutation.mutate,
    isSaving: saveMutation.isPending,
  };
}
