import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCrmAuth } from './useCrmAuth';
import { useToast } from '@/hooks/use-toast';
import type { ClientLifecycleStage, CrmCampaignTrigger } from '@/lib/crm/campaign-types';

export function useCampaignTrigger(campaignId: string | undefined) {
  const { tenantId } = useCrmAuth();

  return useQuery({
    queryKey: ['crm-campaign-trigger', campaignId],
    queryFn: async (): Promise<CrmCampaignTrigger | null> => {
      if (!tenantId || !campaignId) return null;

      const { data, error } = await supabase
        .from('crm_campaign_triggers')
        .select('*')
        .eq('campaign_id', campaignId)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (error) throw error;
      return data as CrmCampaignTrigger | null;
    },
    enabled: !!tenantId && !!campaignId,
  });
}

export function useAllCampaignTriggers() {
  const { tenantId } = useCrmAuth();

  return useQuery({
    queryKey: ['crm-campaign-triggers', tenantId],
    queryFn: async (): Promise<CrmCampaignTrigger[]> => {
      if (!tenantId) return [];

      const { data, error } = await supabase
        .from('crm_campaign_triggers')
        .select('*')
        .eq('tenant_id', tenantId);

      if (error) throw error;
      return (data || []) as CrmCampaignTrigger[];
    },
    enabled: !!tenantId,
  });
}

export function useSaveCampaignTrigger() {
  const queryClient = useQueryClient();
  const { tenantId } = useCrmAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      campaignId,
      triggerLifecycle,
    }: {
      campaignId: string;
      triggerLifecycle: ClientLifecycleStage | null;
    }) => {
      if (!tenantId) throw new Error('Not authenticated');

      await supabase
        .from('crm_campaign_triggers')
        .delete()
        .eq('campaign_id', campaignId)
        .eq('tenant_id', tenantId);

      if (triggerLifecycle) {
        const payload = {
          campaign_id: campaignId,
          tenant_id: tenantId,
          trigger_on_status: null,
          trigger_dimension: 'lifecycle_stage',
          trigger_operator: 'equals',
          trigger_value: triggerLifecycle,
          trigger_event: 'lifecycle_changed',
          trigger_version: 1,
          is_manual_only: false,
          is_active: true,
        };

        const { error } = await supabase
          .from('crm_campaign_triggers')
          .insert(payload as never);

        if (error) {
          if (error.code === '23505') {
            throw new Error(`Another campaign already starts when a client enters ${triggerLifecycle}. Only one automatic client campaign may own each lifecycle entry.`);
          }
          throw error;
        }
      }
    },
    onSuccess: (_, { campaignId }) => {
      queryClient.invalidateQueries({ queryKey: ['crm-campaign-trigger', campaignId] });
      queryClient.invalidateQueries({ queryKey: ['crm-campaign-triggers'] });
    },
    onError: (error) => {
      toast({
        title: 'Error saving trigger',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}
