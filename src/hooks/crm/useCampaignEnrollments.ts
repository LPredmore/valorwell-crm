import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCrmAuth } from './useCrmAuth';
import { useToast } from '@/hooks/use-toast';
import type { CrmCampaignEnrollment, EnrollmentStatus } from '@/lib/crm/campaign-types';

interface EnrollmentWithDetails extends CrmCampaignEnrollment {
  client: {
    id: string;
    pat_name_f: string | null;
    pat_name_l: string | null;
    pat_name_preferred: string | null;
    email: string | null;
    phone: string | null;
  } | null;
  campaign: {
    id: string;
    name: string;
  } | null;
}

/**
 * Fetch all enrollments for a specific campaign
 */
export function useCampaignEnrollments(campaignId: string | undefined) {
  const { tenantId } = useCrmAuth();

  return useQuery({
    queryKey: ['crm-campaign-enrollments', campaignId],
    queryFn: async (): Promise<EnrollmentWithDetails[]> => {
      if (!tenantId || !campaignId) return [];

      const { data, error } = await supabase
        .from('crm_campaign_enrollments')
        .select(`
          *,
          client:clients!crm_campaign_enrollments_client_id_fkey (
            id,
            pat_name_f,
            pat_name_l,
            pat_name_preferred,
            email,
            phone
          ),
          campaign:crm_campaigns!crm_campaign_enrollments_campaign_id_fkey (
            id,
            name
          )
        `)
        .eq('campaign_id', campaignId)
        .eq('tenant_id', tenantId)
        .order('enrolled_at', { ascending: false });

      if (error) throw error;
      return (data || []) as EnrollmentWithDetails[];
    },
    enabled: !!tenantId && !!campaignId,
  });
}

/**
 * Fetch active enrollment for a specific client (for Quick Profile)
 */
export function useClientActiveEnrollment(clientId: string | undefined) {
  const { tenantId } = useCrmAuth();

  return useQuery({
    queryKey: ['crm-client-enrollment', clientId],
    queryFn: async (): Promise<EnrollmentWithDetails | null> => {
      if (!tenantId || !clientId) return null;

      const { data, error } = await supabase
        .from('crm_campaign_enrollments')
        .select(`
          *,
          campaign:crm_campaigns!crm_campaign_enrollments_campaign_id_fkey (
            id,
            name
          )
        `)
        .eq('client_id', clientId)
        .eq('tenant_id', tenantId)
        .eq('status', 'active')
        .maybeSingle();

      if (error) throw error;
      return data as EnrollmentWithDetails | null;
    },
    enabled: !!tenantId && !!clientId,
  });
}

/**
 * Enroll one or more clients in a campaign
 */
export function useEnrollClients() {
  const queryClient = useQueryClient();
  const { tenantId, userId } = useCrmAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      campaignId,
      clientIds,
    }: {
      campaignId: string;
      clientIds: string[];
    }): Promise<{ enrolled: number; skipped: number }> => {
      if (!tenantId || !userId) throw new Error('Not authenticated');

      // Check for existing active enrollments
      const { data: existingEnrollments } = await supabase
        .from('crm_campaign_enrollments')
        .select('client_id')
        .in('client_id', clientIds)
        .eq('tenant_id', tenantId)
        .eq('status', 'active');

      const alreadyEnrolledIds = new Set(existingEnrollments?.map(e => e.client_id) || []);
      const toEnroll = clientIds.filter(id => !alreadyEnrolledIds.has(id));

      if (toEnroll.length === 0) {
        return { enrolled: 0, skipped: clientIds.length };
      }

      // Get first active step for this campaign
      const { data: firstStep } = await supabase
        .from('crm_campaign_steps')
        .select('id, delay_days, delay_hours, channel')
        .eq('campaign_id', campaignId)
        .eq('is_active', true)
        .order('step_order', { ascending: true })
        .limit(1)
        .maybeSingle();

      const enrollments = toEnroll.map(clientId => ({
        campaign_id: campaignId,
        client_id: clientId,
        tenant_id: tenantId,
        current_step: 0,
        status: 'active' as const,
        enrolled_at: new Date().toISOString(),
        enrolled_by_profile_id: userId,
      }));

      // Insert enrollments and get the created records
      const { data: createdEnrollments, error } = await supabase
        .from('crm_campaign_enrollments')
        .insert(enrollments)
        .select('id, client_id');

      if (error) throw error;

      // Schedule the first step for each enrollment
      if (firstStep && createdEnrollments && createdEnrollments.length > 0) {
        const now = new Date();
        const scheduledFor = new Date(now);
        scheduledFor.setDate(scheduledFor.getDate() + (firstStep.delay_days || 0));
        scheduledFor.setHours(scheduledFor.getHours() + (firstStep.delay_hours || 0));

        const stepLogs = createdEnrollments.map(enrollment => ({
          enrollment_id: enrollment.id,
          step_id: firstStep.id,
          tenant_id: tenantId,
          client_id: enrollment.client_id,
          scheduled_for: scheduledFor.toISOString(),
          status: 'scheduled' as const,
          channel: firstStep.channel,
        }));

        const { error: stepLogError } = await supabase
          .from('crm_campaign_step_logs')
          .insert(stepLogs);

        if (stepLogError) {
          console.error('Failed to schedule first step:', stepLogError);
          // Don't throw - enrollment succeeded, step scheduling is secondary
        }
      }

      return { enrolled: toEnroll.length, skipped: alreadyEnrolledIds.size };
    },
    onSuccess: (result, { campaignId }) => {
      queryClient.invalidateQueries({ queryKey: ['crm-campaign-enrollments', campaignId] });
      queryClient.invalidateQueries({ queryKey: ['crm-campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['crm-client-enrollment'] });
      
      if (result.skipped > 0) {
        toast({
          title: 'Clients enrolled',
          description: `${result.enrolled} enrolled, ${result.skipped} skipped (already in a campaign)`,
        });
      } else {
        toast({
          title: 'Clients enrolled',
          description: `${result.enrolled} client${result.enrolled !== 1 ? 's' : ''} enrolled successfully.`,
        });
      }
    },
    onError: (error) => {
      toast({
        title: 'Error enrolling clients',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

/**
 * Update enrollment status (pause, resume, cancel)
 */
export function useUpdateEnrollmentStatus() {
  const queryClient = useQueryClient();
  const { tenantId } = useCrmAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      enrollmentId,
      status,
      pauseReason,
    }: {
      enrollmentId: string;
      status: EnrollmentStatus;
      pauseReason?: string;
    }): Promise<void> => {
      if (!tenantId) throw new Error('Not authenticated');

      const updates: Record<string, unknown> = { status };
      
      if (status === 'paused') {
        updates.paused_at = new Date().toISOString();
        updates.pause_reason = pauseReason || null;
      } else if (status === 'active') {
        updates.paused_at = null;
        updates.pause_reason = null;
      } else if (status === 'completed' || status === 'cancelled') {
        updates.completed_at = new Date().toISOString();
      }

      const { error } = await supabase
        .from('crm_campaign_enrollments')
        .update(updates)
        .eq('id', enrollmentId)
        .eq('tenant_id', tenantId);

      if (error) throw error;
    },
    onSuccess: (_, { status }) => {
      queryClient.invalidateQueries({ queryKey: ['crm-campaign-enrollments'] });
      queryClient.invalidateQueries({ queryKey: ['crm-campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['crm-client-enrollment'] });
      
      const actionMap: Record<EnrollmentStatus, string> = {
        active: 'resumed',
        paused: 'paused',
        cancelled: 'cancelled',
        completed: 'marked as completed',
        responded: 'marked as responded',
      };
      
      toast({
        title: 'Enrollment updated',
        description: `Enrollment has been ${actionMap[status]}.`,
      });
    },
    onError: (error) => {
      toast({
        title: 'Error updating enrollment',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

/**
 * Remove enrollment entirely
 */
export function useDeleteEnrollment() {
  const queryClient = useQueryClient();
  const { tenantId } = useCrmAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (enrollmentId: string): Promise<void> => {
      if (!tenantId) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('crm_campaign_enrollments')
        .delete()
        .eq('id', enrollmentId)
        .eq('tenant_id', tenantId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-campaign-enrollments'] });
      queryClient.invalidateQueries({ queryKey: ['crm-campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['crm-client-enrollment'] });
      toast({
        title: 'Enrollment removed',
        description: 'The client has been removed from the campaign.',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error removing enrollment',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}
