import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCrmAuth } from './useCrmAuth';
import { useToast } from '@/hooks/use-toast';
import type { CrmCampaign, CampaignFormData } from '@/lib/crm/campaign-types';

function normalizeCampaign(row: unknown): CrmCampaign {
  const campaign = row as Record<string, unknown>;
  return {
    ...(campaign as unknown as CrmCampaign),
    on_complete_lifecycle_stage: (campaign.on_complete_lifecycle_stage as CrmCampaign['on_complete_lifecycle_stage']) ?? null,
    on_complete_engagement_state: (campaign.on_complete_engagement_state as CrmCampaign['on_complete_engagement_state']) ?? null,
    on_complete_action: ((campaign.on_complete_action as string) || 'do_nothing') as 'do_nothing' | 'change_status',
    on_complete_status: (campaign.on_complete_status as string | null) ?? null,
  };
}

export function useCampaigns() {
  const { tenantId } = useCrmAuth();

  return useQuery({
    queryKey: ['crm-campaigns', tenantId],
    queryFn: async (): Promise<CrmCampaign[]> => {
      if (!tenantId) return [];

      const { data: campaigns, error } = await supabase
        .from('crm_campaigns')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      if (!campaigns || campaigns.length === 0) return [];

      const campaignIds = campaigns.map(c => c.id);
      const { data: stepsCounts } = await supabase
        .from('crm_campaign_steps')
        .select('campaign_id')
        .in('campaign_id', campaignIds);

      const { data: enrollmentsCounts } = await supabase
        .from('crm_campaign_enrollments')
        .select('campaign_id')
        .in('campaign_id', campaignIds)
        .eq('status', 'active');

      const stepsCountMap = new Map<string, number>();
      const enrollmentsCountMap = new Map<string, number>();

      stepsCounts?.forEach(s => {
        stepsCountMap.set(s.campaign_id, (stepsCountMap.get(s.campaign_id) || 0) + 1);
      });

      enrollmentsCounts?.forEach(e => {
        enrollmentsCountMap.set(e.campaign_id, (enrollmentsCountMap.get(e.campaign_id) || 0) + 1);
      });

      return campaigns.map(row => {
        const campaign = normalizeCampaign(row);
        return {
          ...campaign,
          steps_count: stepsCountMap.get(campaign.id) || 0,
          active_enrollments_count: enrollmentsCountMap.get(campaign.id) || 0,
        };
      });
    },
    enabled: !!tenantId,
    refetchOnWindowFocus: true,
    staleTime: 30000,
    refetchOnMount: 'always',
  });
}

export function useCampaign(campaignId: string | undefined) {
  const { tenantId } = useCrmAuth();

  return useQuery({
    queryKey: ['crm-campaign', campaignId],
    queryFn: async (): Promise<CrmCampaign | null> => {
      if (!tenantId || !campaignId) return null;

      const { data, error } = await supabase
        .from('crm_campaigns')
        .select('*')
        .eq('id', campaignId)
        .eq('tenant_id', tenantId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') return null;
        throw error;
      }

      return normalizeCampaign(data);
    },
    enabled: !!tenantId && !!campaignId,
  });
}

export function useCreateCampaign() {
  const queryClient = useQueryClient();
  const { tenantId, userId } = useCrmAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (formData: CampaignFormData): Promise<CrmCampaign> => {
      if (!tenantId || !userId) throw new Error('Not authenticated');

      const payload = {
        tenant_id: tenantId,
        name: formData.name,
        description: formData.description || null,
        is_active: formData.is_active,
        weekdays_only: formData.weekdays_only,
        send_window_start: formData.send_window_start,
        send_window_end: formData.send_window_end,
        default_timezone: formData.default_timezone,
        on_complete_lifecycle_stage: formData.on_complete_lifecycle_stage,
        on_complete_engagement_state: formData.on_complete_engagement_state,
        on_complete_action: 'do_nothing',
        on_complete_status: null,
        created_by_profile_id: userId,
      };

      const { data, error } = await supabase
        .from('crm_campaigns')
        .insert(payload as never)
        .select()
        .single();

      if (error) throw error;
      return normalizeCampaign(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-campaigns'] });
      toast({
        title: 'Campaign created',
        description: 'Your campaign has been created successfully.',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error creating campaign',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

export function useUpdateCampaign() {
  const queryClient = useQueryClient();
  const { tenantId } = useCrmAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ campaignId, formData }: { campaignId: string; formData: Partial<CampaignFormData> }): Promise<CrmCampaign> => {
      if (!tenantId) throw new Error('Not authenticated');

      const payload = {
        name: formData.name,
        description: formData.description || null,
        is_active: formData.is_active,
        weekdays_only: formData.weekdays_only,
        send_window_start: formData.send_window_start,
        send_window_end: formData.send_window_end,
        default_timezone: formData.default_timezone,
        on_complete_lifecycle_stage: formData.on_complete_lifecycle_stage,
        on_complete_engagement_state: formData.on_complete_engagement_state,
        on_complete_action: 'do_nothing',
        on_complete_status: null,
      };

      const { data, error } = await supabase
        .from('crm_campaigns')
        .update(payload as never)
        .eq('id', campaignId)
        .eq('tenant_id', tenantId)
        .select()
        .single();

      if (error) throw error;
      return normalizeCampaign(data);
    },
    onSuccess: (_, { campaignId }) => {
      queryClient.invalidateQueries({ queryKey: ['crm-campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['crm-campaign', campaignId] });
      toast({
        title: 'Campaign updated',
        description: 'Your changes have been saved.',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error updating campaign',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

export function useDeleteCampaign() {
  const queryClient = useQueryClient();
  const { tenantId } = useCrmAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (campaignId: string): Promise<void> => {
      if (!tenantId) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('crm_campaigns')
        .delete()
        .eq('id', campaignId)
        .eq('tenant_id', tenantId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-campaigns'] });
      toast({ title: 'Campaign deleted', description: 'The campaign has been permanently removed.' });
    },
    onError: (error) => {
      toast({ title: 'Error deleting campaign', description: error.message, variant: 'destructive' });
    },
  });
}

export function useDuplicateCampaign() {
  const queryClient = useQueryClient();
  const { tenantId, userId } = useCrmAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (sourceCampaign: CrmCampaign): Promise<string> => {
      if (!tenantId || !userId) throw new Error('Not authenticated');

      const { data: newCampaign, error: campaignError } = await supabase
        .from('crm_campaigns')
        .insert({
          tenant_id: tenantId,
          name: `Copy of ${sourceCampaign.name}`,
          description: sourceCampaign.description,
          is_active: false,
          weekdays_only: sourceCampaign.weekdays_only,
          send_window_start: sourceCampaign.send_window_start,
          send_window_end: sourceCampaign.send_window_end,
          default_timezone: sourceCampaign.default_timezone,
          on_complete_lifecycle_stage: sourceCampaign.on_complete_lifecycle_stage,
          on_complete_engagement_state: sourceCampaign.on_complete_engagement_state,
          on_complete_action: 'do_nothing',
          on_complete_status: null,
          created_by_profile_id: userId,
        } as never)
        .select()
        .single();

      if (campaignError) throw campaignError;

      const { data: steps, error: stepsError } = await supabase
        .from('crm_campaign_steps')
        .select('*')
        .eq('campaign_id', sourceCampaign.id)
        .order('step_order', { ascending: true });

      if (stepsError) throw stepsError;

      if (steps && steps.length > 0) {
        const newSteps = steps.map(s => ({
          campaign_id: newCampaign.id,
          tenant_id: tenantId,
          step_order: s.step_order,
          delay_days: s.delay_days,
          delay_hours: s.delay_hours,
          channel: s.channel,
          email_subject: s.email_subject,
          email_body_html: s.email_body_html,
          sms_body_text: s.sms_body_text,
          is_active: s.is_active,
        }));

        const { error: insertError } = await supabase
          .from('crm_campaign_steps')
          .insert(newSteps);

        if (insertError) throw insertError;
      }

      return newCampaign.id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-campaigns'] });
      toast({ title: 'Campaign duplicated', description: 'A paused copy has been created. You can now edit it.' });
    },
    onError: (error) => {
      toast({ title: 'Error duplicating campaign', description: error.message, variant: 'destructive' });
    },
  });
}

export function useToggleCampaignActive() {
  const queryClient = useQueryClient();
  const { tenantId } = useCrmAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ campaignId, isActive }: { campaignId: string; isActive: boolean }): Promise<void> => {
      if (!tenantId) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('crm_campaigns')
        .update({ is_active: isActive })
        .eq('id', campaignId)
        .eq('tenant_id', tenantId);

      if (error) throw error;
    },
    onSuccess: (_, { isActive }) => {
      queryClient.invalidateQueries({ queryKey: ['crm-campaigns'] });
      toast({
        title: isActive ? 'Campaign activated' : 'Campaign paused',
        description: isActive
          ? 'New messages will be scheduled for enrolled clients.'
          : 'No new messages will be sent until reactivated.',
      });
    },
    onError: (error) => {
      toast({ title: 'Error updating campaign', description: error.message, variant: 'destructive' });
    },
  });
}
