import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCrmAuth } from './useCrmAuth';
import { useToast } from '@/hooks/use-toast';
import type { CrmCampaign, CampaignFormData } from '@/lib/crm/campaign-types';

export function useCampaigns() {
  const { tenantId } = useCrmAuth();

  return useQuery({
    queryKey: ['crm-campaigns', tenantId],
    queryFn: async (): Promise<CrmCampaign[]> => {
      if (!tenantId) return [];

      // First get campaigns
      const { data: campaigns, error } = await supabase
        .from('crm_campaigns')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      if (!campaigns || campaigns.length === 0) return [];

      // Get steps count for each campaign
      const campaignIds = campaigns.map(c => c.id);
      const { data: stepsCounts } = await supabase
        .from('crm_campaign_steps')
        .select('campaign_id')
        .in('campaign_id', campaignIds);

      // Get active enrollments count
      const { data: enrollmentsCounts } = await supabase
        .from('crm_campaign_enrollments')
        .select('campaign_id')
        .in('campaign_id', campaignIds)
        .eq('status', 'active');

      // Count by campaign
      const stepsCountMap = new Map<string, number>();
      const enrollmentsCountMap = new Map<string, number>();

      stepsCounts?.forEach(s => {
        stepsCountMap.set(s.campaign_id, (stepsCountMap.get(s.campaign_id) || 0) + 1);
      });

      enrollmentsCounts?.forEach(e => {
        enrollmentsCountMap.set(e.campaign_id, (enrollmentsCountMap.get(e.campaign_id) || 0) + 1);
      });

      return campaigns.map(c => ({
        ...c,
        steps_count: stepsCountMap.get(c.id) || 0,
        active_enrollments_count: enrollmentsCountMap.get(c.id) || 0,
      }));
    },
    enabled: !!tenantId,
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

      return data;
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

      const { data, error } = await supabase
        .from('crm_campaigns')
        .insert({
          tenant_id: tenantId,
          name: formData.name,
          description: formData.description || null,
          is_active: formData.is_active,
          weekdays_only: formData.weekdays_only,
          send_window_start: formData.send_window_start,
          send_window_end: formData.send_window_end,
          default_timezone: formData.default_timezone,
          created_by_profile_id: userId,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
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
    mutationFn: async ({
      campaignId,
      formData,
    }: {
      campaignId: string;
      formData: Partial<CampaignFormData>;
    }): Promise<CrmCampaign> => {
      if (!tenantId) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('crm_campaigns')
        .update({
          name: formData.name,
          description: formData.description || null,
          is_active: formData.is_active,
          weekdays_only: formData.weekdays_only,
          send_window_start: formData.send_window_start,
          send_window_end: formData.send_window_end,
          default_timezone: formData.default_timezone,
        })
        .eq('id', campaignId)
        .eq('tenant_id', tenantId)
        .select()
        .single();

      if (error) throw error;
      return data;
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
      toast({
        title: 'Campaign deleted',
        description: 'The campaign has been permanently removed.',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error deleting campaign',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

export function useToggleCampaignActive() {
  const queryClient = useQueryClient();
  const { tenantId } = useCrmAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      campaignId,
      isActive,
    }: {
      campaignId: string;
      isActive: boolean;
    }): Promise<void> => {
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
      toast({
        title: 'Error updating campaign',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}
