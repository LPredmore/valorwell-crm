import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { CrmClient, ClientFilters, PatStatus } from '@/lib/crm/types';
import { useCrmAuth } from './useCrmAuth';

interface UseClientsOptions {
  filters?: ClientFilters;
  enabled?: boolean;
}

export function useClients(options: UseClientsOptions = {}) {
  const { tenantId, isAuthenticated } = useCrmAuth();
  const { filters, enabled = true } = options;

  return useQuery({
    queryKey: ['crm-clients', tenantId, filters],
    queryFn: async (): Promise<CrmClient[]> => {
      let query = supabase
        .from('clients')
        .select(`
          id,
          tenant_id,
          pat_name_f,
          pat_name_m,
          pat_name_l,
          pat_name_preferred,
          email,
          phone,
          pat_state,
          pat_status,
          created_at,
          updated_at,
          primary_staff:staff!clients_primary_staff_id_fkey (
            id,
            prov_name_f,
            prov_name_l,
            prov_name_for_clients
          )
        `)
        .eq('tenant_id', tenantId)
        .order('updated_at', { ascending: false });

      // Apply status filter
      if (filters?.statuses && filters.statuses.length > 0) {
        query = query.in('pat_status', filters.statuses);
      }

      // Apply state filter - cast to any to handle state enum
      if (filters?.states && filters.states.length > 0) {
        query = query.in('pat_state', filters.states as any);
      }

      // Apply search filter
      if (filters?.search && filters.search.trim()) {
        const searchTerm = `%${filters.search.trim()}%`;
        query = query.or(`pat_name_f.ilike.${searchTerm},pat_name_l.ilike.${searchTerm},pat_name_preferred.ilike.${searchTerm},email.ilike.${searchTerm},phone.ilike.${searchTerm}`);
      }

      // Apply tags filter
      if (filters?.tags && filters.tags.length > 0) {
        // Filter clients whose tags field contains any of the selected tags
        const tagFilters = filters.tags.map(tag => `tags.ilike.%${tag}%`).join(',');
        query = query.or(tagFilters);
      }

      // Apply joined date range filter
      if (filters?.joinedDateFrom) {
        query = query.gte('created_at', filters.joinedDateFrom.toISOString());
      }
      if (filters?.joinedDateTo) {
        // Include the entire "To" date by setting to end of day
        const endOfDay = new Date(filters.joinedDateTo);
        endOfDay.setHours(23, 59, 59, 999);
        query = query.lte('created_at', endOfDay.toISOString());
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching clients:', error);
        throw error;
      }

      // Transform the data to match CrmClient type
      let clientsData = (data || []).map(client => ({
        ...client,
        pat_status: client.pat_status as PatStatus | null,
        primary_staff: Array.isArray(client.primary_staff) 
          ? client.primary_staff[0] || null 
          : client.primary_staff,
      }));

      // Apply active campaign filter client-side
      if (filters?.activeCampaign && filters.activeCampaign !== 'all') {
        const { data: activeEnrollments } = await supabase
          .from('crm_campaign_enrollments')
          .select('client_id')
          .eq('tenant_id', tenantId)
          .eq('status', 'active');
        
        const enrolledClientIds = new Set(activeEnrollments?.map(e => e.client_id) || []);
        
        if (filters.activeCampaign === 'yes') {
          clientsData = clientsData.filter(client => enrolledClientIds.has(client.id));
        } else {
          clientsData = clientsData.filter(client => !enrolledClientIds.has(client.id));
        }
      }

      return clientsData;
    },
    enabled: enabled && isAuthenticated && !!tenantId,
  });
}

export function useClientsByStatus(options: UseClientsOptions = {}) {
  const clientsQuery = useClients(options);

  const clientsByStatus = clientsQuery.data?.reduce((acc, client) => {
    const status = client.pat_status || 'New';
    if (!acc[status]) {
      acc[status] = [];
    }
    acc[status].push(client);
    return acc;
  }, {} as Record<PatStatus, CrmClient[]>) || {};

  return {
    ...clientsQuery,
    clientsByStatus,
  };
}
