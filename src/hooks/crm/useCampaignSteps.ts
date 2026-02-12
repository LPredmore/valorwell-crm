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

      // Get existing steps
      const { data: existingSteps } = await supabase
        .from('crm_campaign_steps')
        .select('id')
        .eq('campaign_id', campaignId)
        .eq('tenant_id', tenantId);

      const existingIds = new Set(existingSteps?.map(s => s.id) || []);
      const newStepIds = new Set(steps.filter(s => s.id).map(s => s.id));

      // Find steps to delete (existing but not in new list)
      const toDelete = [...existingIds].filter(id => !newStepIds.has(id));

      // Delete removed steps
      if (toDelete.length > 0) {
        const { error: deleteError } = await supabase
          .from('crm_campaign_steps')
          .delete()
          .in('id', toDelete)
          .eq('tenant_id', tenantId);

        if (deleteError) throw deleteError;
      }

      // Upsert all steps
      for (const step of steps) {
        if (step.id && existingIds.has(step.id)) {
          // Update existing
          const { error } = await supabase
            .from('crm_campaign_steps')
            .update({
              step_order: step.step_order,
              delay_days: step.delay_days,
              delay_hours: step.delay_hours,
              channel: step.channel,
              email_subject: step.channel === 'email' ? step.email_subject : null,
              email_body_html: step.channel === 'email' ? step.email_body_html : null,
              sms_body_text: step.channel === 'sms' ? step.sms_body_text : null,
              is_active: step.is_active,
              signature_id: step.channel === 'email' ? step.signature_id : null,
            })
            .eq('id', step.id)
            .eq('tenant_id', tenantId);

          if (error) throw error;
        } else {
          // Insert new
          const { error } = await supabase.from('crm_campaign_steps').insert({
            campaign_id: campaignId,
            tenant_id: tenantId,
            step_order: step.step_order,
            delay_days: step.delay_days,
            delay_hours: step.delay_hours,
            channel: step.channel,
            email_subject: step.channel === 'email' ? step.email_subject : null,
            email_body_html: step.channel === 'email' ? step.email_body_html : null,
            sms_body_text: step.channel === 'sms' ? step.sms_body_text : null,
            is_active: step.is_active,
            signature_id: step.channel === 'email' ? step.signature_id : null,
          });

          if (error) throw error;
        }
      }
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
