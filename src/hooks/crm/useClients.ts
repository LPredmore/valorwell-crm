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
          tags,
          created_at,
          updated_at,
          last_contact_at,
          last_contact_direction,
          last_contact_channel,
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

      // Apply tags filter.
      // `clients.tags` is stored as a single-value string (not a delimited list),
      // so use exact match via .in() to avoid substring collisions like the previous
      // ILIKE %tag% approach matching "VIP" inside "Non-VIP".
      if (filters?.tags && filters.tags.length > 0) {
        query = query.in('tags', filters.tags);
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
      let clientsData: CrmClient[] = (data || []).map(client => ({
        ...client,
        pat_status: client.pat_status as PatStatus | null,
        last_contact_direction: client.last_contact_direction as 'sent' | 'received' | null,
        last_contact_channel: client.last_contact_channel as 'email' | 'sms' | null,
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

      // Apply communication received filter client-side
      if (filters?.communicationReceivedDays) {
        const since = new Date();
        since.setDate(since.getDate() - filters.communicationReceivedDays);
        
        const { data: recentComms } = await supabase
          .from('crm_activity_events')
          .select('client_id')
          .eq('tenant_id', tenantId)
          .in('event_type', ['email_received', 'sms_received'])
          .gte('created_at', since.toISOString());
        
        const commClientIds = new Set(recentComms?.map(e => e.client_id) || []);
        clientsData = clientsData.filter(client => commClientIds.has(client.id));
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
