import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
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
      return (data || []).map((step) => ({
        ...step,
        channel: step.channel as 'email' | 'sms',
      })) as unknown as CrmCampaignStep[];
    },
    enabled: !!tenantId && !!campaignId,
  });
}

export function campaignStepsPayload(steps: CampaignStepFormData[]) {
  return steps.map((step) => {
    const base = {
      id: step.id ?? null,
      step_order: step.step_order,
      delay_days: step.delay_days,
      delay_hours: step.delay_hours,
      channel: step.channel,
      email_subject: step.channel === 'email' ? step.email_subject || null : null,
      email_body_html: step.channel === 'email' ? step.email_body_html || null : null,
      sms_body_text: step.channel === 'sms' ? step.sms_body_text || null : null,
      is_active: step.is_active,
      signature_id: step.channel === 'email' ? step.signature_id ?? null : null,
    };

    if (step.channel !== 'email' || !step.email_content) return base;
    return {
      ...base,
      email_content_mode: 'campaign',
      email_editor_document: step.email_content.editorDocument,
      email_body_html: step.email_content.renderedHtml,
      email_body_text: step.email_content.renderedText,
      email_preheader: step.email_content.preheader,
      email_theme_key: step.email_content.themeKey,
      email_editor_schema_version: step.email_content.schemaVersion,
      email_render_hash: step.email_content.renderHash,
      email_template_id: step.email_template_id,
      email_template_version_id: step.email_template_version_id,
    };
  });
}

export function useSaveCampaignSteps() {
  const queryClient = useQueryClient();
  const { tenantId } = useCrmAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ campaignId, steps }: { campaignId: string; steps: CampaignStepFormData[] }): Promise<void> => {
      if (!tenantId) throw new Error('Not authenticated');
      const { error } = await supabase.rpc('crm_save_campaign_steps', {
        p_campaign_id: campaignId,
        p_tenant_id: tenantId,
        p_steps: campaignStepsPayload(steps) as unknown as Json,
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
