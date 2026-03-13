import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCrmAuth } from './useCrmAuth';
import { useToast } from '@/hooks/use-toast';
import type { CrmCampaignTrigger } from '@/lib/crm/campaign-types';

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
      return data;
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
      return data || [];
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
      triggerStatus,
    }: {
      campaignId: string;
      triggerStatus: string | null;
    }) => {
      if (!tenantId) throw new Error('Not authenticated');

      // Delete existing trigger for this campaign
      await supabase
        .from('crm_campaign_triggers')
        .delete()
        .eq('campaign_id', campaignId)
        .eq('tenant_id', tenantId);

      // Insert new trigger if status is set
      if (triggerStatus) {
        const { error } = await supabase
          .from('crm_campaign_triggers')
          .insert({
            campaign_id: campaignId,
            tenant_id: tenantId,
            trigger_on_status: triggerStatus,
            is_active: true,
          });

        if (error) {
          if (error.code === '23505') {
            throw new Error(`Another campaign already has an auto-enroll trigger for "${triggerStatus}". Only one campaign per trigger status is allowed.`);
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
