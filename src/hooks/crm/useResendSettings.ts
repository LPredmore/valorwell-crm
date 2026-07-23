import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { resendEmailApi } from '@/lib/crm/resend-api';
import { useCrmAuth } from './useCrmAuth';

export interface ResendSettings {
  tenant_id: string;
  from_name: string | null;
  from_email: string | null;
  reply_to_email: string | null;
  inbound_email: string | null;
  connection_status: 'disconnected' | 'connected' | 'error';
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
}

interface TestConnectionResult {
  connected: boolean;
  provider: 'resend';
  fromEmail: string;
  inboundEmail: string;
  domains: string[];
  domainStatus: string;
  verifiedAt: string;
}

type ResendSettingsUpdate = Pick<
  ResendSettings,
  'from_name' | 'from_email' | 'reply_to_email' | 'inbound_email'
>;

type UntypedQueryResult = {
  data: unknown;
  error: { message: string } | null;
};

type UntypedQuery = PromiseLike<UntypedQueryResult> & {
  select: (columns: string) => UntypedQuery;
  eq: (column: string, value: unknown) => UntypedQuery;
  maybeSingle: () => Promise<UntypedQueryResult>;
  upsert: (values: Record<string, unknown>, options?: { onConflict?: string }) => UntypedQuery;
  single: () => Promise<UntypedQueryResult>;
};

const untypedSupabase = supabase as unknown as {
  from: (relation: string) => UntypedQuery;
};

export function useResendSettings() {
  const { tenantId, isAuthenticated, isLoading: authLoading } = useCrmAuth();
  const queryClient = useQueryClient();
  const queryKey = ['resend-settings', tenantId] as const;

  const { data: settings, isLoading, error } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!tenantId) return null;
      const { data, error: queryError } = await untypedSupabase
        .from('crm_resend_email_settings')
        .select('*')
        .eq('tenant_id', tenantId)
        .maybeSingle();
      if (queryError) throw queryError;
      return data as ResendSettings | null;
    },
    enabled: isAuthenticated && !!tenantId,
  });

  const updateConnectionStatus = async (
    status: ResendSettings['connection_status'],
    verifiedAt?: string,
  ) => {
    if (!tenantId) return;
    await untypedSupabase.from('crm_resend_email_settings').upsert(
      {
        tenant_id: tenantId,
        connection_status: status,
        last_verified_at: verifiedAt ?? settings?.last_verified_at ?? null,
      },
      { onConflict: 'tenant_id' },
    );
    await queryClient.invalidateQueries({ queryKey });
  };

  const testConnection = useMutation({
    mutationFn: () =>
      resendEmailApi<TestConnectionResult>('test-connection', { params: { tenantId: tenantId ?? '' } }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey }),
    onError: async () => updateConnectionStatus('error'),
  });

  const updateSettings = useMutation({
    mutationFn: async (updates: ResendSettingsUpdate) => {
      if (!tenantId) throw new Error('No tenant');
      const { data, error: updateError } = await untypedSupabase
        .from('crm_resend_email_settings')
        .upsert(
          {
            tenant_id: tenantId,
            ...updates,
            connection_status: 'disconnected',
            last_verified_at: null,
          },
          { onConflict: 'tenant_id' },
        )
        .select('*')
        .single();
      if (updateError) throw updateError;
      return data as ResendSettings;
    },
    onSuccess: async () => queryClient.invalidateQueries({ queryKey }),
  });

  return {
    settings,
    isLoading,
    error,
    testConnection,
    updateSettings,
    isConnected: settings?.connection_status === 'connected',
    isPending: authLoading || (isAuthenticated && !!tenantId && isLoading),
  };
}
