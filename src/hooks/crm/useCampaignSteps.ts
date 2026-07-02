import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCrmAuth } from './useCrmAuth';
import { useToast } from '@/hooks/use-toast';
import type { CrmCampaignStep, CampaignStepFormData } from '@/lib/crm/campaign-types';

export function useCampaignSteps(campaignId: string | undefined) {
  const { tenantId } = useCrmAuth();

  return useQuery({
    queryKey: ['crm-campaign-steps', campaignId],
    queryFn: async (): Promise<CrmCampaignStep[]> => {
      if (!tenantId || !campaignId) return [];

      const { data, error } = await supabase
        .from('crm_campaign_steps')
        .select('*')
        .eq('campaign_id', campaignId)
        .eq('tenant_id', tenantId)
        .order('step_order', { ascending: true });

      if (error) throw error;
      
      // Cast channel to the correct type
      return (data || []).map(step => ({
        ...step,
        channel: step.channel as 'email' | 'sms',
      }));
    },
    enabled: !!tenantId && !!campaignId,
  });
}

export function useSaveCampaignSteps() {
  const queryClient = useQueryClient();
  const { tenantId } = useCrmAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      campaignId,
      steps,
    }: {
      campaignId: string;
      steps: CampaignStepFormData[];
    }): Promise<void> => {
      if (!tenantId) throw new Error('Not authenticated');

      const payload = steps.map((s) => ({
        id: s.id ?? null,
        step_order: s.step_order,
        delay_days: s.delay_days,
        delay_hours: s.delay_hours,
        channel: s.channel,
        email_subject: s.channel === 'email' ? s.email_subject ?? null : null,
        email_body_html: s.channel === 'email' ? s.email_body_html ?? null : null,
        sms_body_text: s.channel === 'sms' ? s.sms_body_text ?? null : null,
        is_active: s.is_active,
        signature_id: s.channel === 'email' ? s.signature_id ?? null : null,
      }));

      const { error } = await supabase.rpc('crm_save_campaign_steps', {
        p_campaign_id: campaignId,
        p_tenant_id: tenantId,
        p_steps: payload,
      });

      if (error) throw error;
    },
    onSuccess: (_, { campaignId }) => {
      queryClient.invalidateQueries({ queryKey: ['crm-campaign-steps', campaignId] });
      queryClient.invalidateQueries({ queryKey: ['crm-campaigns'] });
    },
    onError: (error) => {
      toast({
        title: 'Error saving steps',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}
