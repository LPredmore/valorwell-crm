import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { CrmStaff, StaffFilters, StaffStatus } from '@/lib/crm/staff-types';
import { useCrmAuth } from './useCrmAuth';

interface UseStaffOptions {
  filters?: StaffFilters;
  enabled?: boolean;
}

export function useStaff(options: UseStaffOptions = {}) {
  const { tenantId, isAuthenticated } = useCrmAuth();
  const { filters, enabled = true } = options;

  return useQuery({
    queryKey: ['crm-staff', tenantId, filters],
    queryFn: async (): Promise<CrmStaff[]> => {
      let query = supabase
        .from('staff')
        .select(`
          id,
          tenant_id,
          prov_name_f,
          prov_name_l,
          prov_name_for_clients,
          prov_status,
          prov_state,
          prov_phone,
          profiles!inner (
            email
          )
        `)
        .eq('tenant_id', tenantId)
        .order('prov_name_l', { ascending: true });

      // Apply status filter
      if (filters?.statuses && filters.statuses.length > 0) {
        query = query.in('prov_status', filters.statuses);
      }

      // Apply state filter
      if (filters?.states && filters.states.length > 0) {
        query = query.in('prov_state', filters.states as any);
      }

      // Apply search filter
      if (filters?.search && filters.search.trim()) {
        const searchTerm = `%${filters.search.trim()}%`;
        query = query.or(`prov_name_f.ilike.${searchTerm},prov_name_l.ilike.${searchTerm},prov_name_for_clients.ilike.${searchTerm}`);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching staff:', error);
        throw error;
      }

      // Transform the data to extract email from profiles
      return (data || []).map(staff => {
        const profiles = staff.profiles as unknown as { email: string | null } | null;
        return {
          id: staff.id,
          tenant_id: staff.tenant_id,
          prov_name_f: staff.prov_name_f,
          prov_name_l: staff.prov_name_l,
          prov_name_for_clients: staff.prov_name_for_clients,
          prov_status: staff.prov_status as StaffStatus | null,
          prov_state: staff.prov_state,
          prov_phone: staff.prov_phone,
          email: profiles?.email ?? null,
        };
      });
    },
    enabled: enabled && isAuthenticated && !!tenantId,
  });
}
