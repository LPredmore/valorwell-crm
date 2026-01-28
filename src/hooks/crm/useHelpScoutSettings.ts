import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCrmAuth } from './useCrmAuth';
import { helpscoutApi, HelpScoutApiError } from '@/lib/crm/helpscout-api';

export interface HelpScoutSettings {
  id: string;
  tenant_id: string;
  mailbox_id: string | null;
  from_name: string | null;
  from_email: string | null;
  connection_status: string;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

interface TestConnectionResult {
  connected: boolean;
  mailboxName: string;
  mailboxEmail: string;
}

export function useHelpScoutSettings() {
  const { tenantId, isAuthenticated } = useCrmAuth();
  const queryClient = useQueryClient();

  const { data: settings, isLoading, error } = useQuery({
    queryKey: ['helpscout-settings', tenantId],
    queryFn: async () => {
      if (!tenantId) return null;
      
      const { data, error } = await supabase
        .from('crm_helpscout_settings')
        .select('*')
        .eq('tenant_id', tenantId)
        .maybeSingle();
      
      if (error) throw error;
      return data as HelpScoutSettings | null;
    },
    enabled: isAuthenticated && !!tenantId,
  });

  const testConnection = useMutation({
    mutationFn: async () => {
      return helpscoutApi<TestConnectionResult>('test-connection');
    },
    onSuccess: async (data) => {
      // Update settings with connected status
      if (tenantId) {
        await supabase
          .from('crm_helpscout_settings')
          .upsert({
            tenant_id: tenantId,
            connection_status: 'connected',
            last_sync_at: new Date().toISOString(),
          }, {
            onConflict: 'tenant_id',
          });
        
        queryClient.invalidateQueries({ queryKey: ['helpscout-settings', tenantId] });
      }
    },
    onError: async () => {
      // Update settings with error status
      if (tenantId) {
        await supabase
          .from('crm_helpscout_settings')
          .upsert({
            tenant_id: tenantId,
            connection_status: 'error',
          }, {
            onConflict: 'tenant_id',
          });
        
        queryClient.invalidateQueries({ queryKey: ['helpscout-settings', tenantId] });
      }
    },
  });

  const updateSettings = useMutation({
    mutationFn: async (updates: Partial<Pick<HelpScoutSettings, 'from_name' | 'from_email'>>) => {
      if (!tenantId) throw new Error('No tenant');
      
      const { data, error } = await supabase
        .from('crm_helpscout_settings')
        .upsert({
          tenant_id: tenantId,
          ...updates,
        }, {
          onConflict: 'tenant_id',
        })
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['helpscout-settings', tenantId] });
    },
  });

  return {
    settings,
    isLoading,
    error,
    testConnection,
    updateSettings,
    isConnected: settings?.connection_status === 'connected',
  };
}
