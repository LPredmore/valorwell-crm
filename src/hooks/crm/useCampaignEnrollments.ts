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
 * Fetch full enrollment history for a client (all statuses, newest first)
 */
export function useClientEnrollmentHistory(clientId: string | undefined) {
  const { tenantId } = useCrmAuth();

  return useQuery({
    queryKey: ['crm-client-enrollment-history', clientId],
    queryFn: async (): Promise<EnrollmentWithDetails[]> => {
      if (!tenantId || !clientId) return [];

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
        .order('enrolled_at', { ascending: false });

      if (error) throw error;
      return (data || []) as EnrollmentWithDetails[];
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
      reason,
    }: {
      campaignId: string;
      clientIds: string[];
      reason?: string;
    }): Promise<{ enrolled: number; skipped: number; suppressed: number; results: Array<Record<string, unknown>> }> => {
      if (!tenantId || !userId) throw new Error('Not authenticated');

      const rpc = (supabase as unknown as {
        rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
      }).rpc;
      const { data, error } = await rpc('crm_enroll_clients_in_campaign', {
        p_campaign_id: campaignId,
        p_client_ids: clientIds,
        p_reason: reason ?? 'manual_enrollment',
        p_idempotency_key: crypto.randomUUID(),
        p_contract_version: 'valorwell-crm-contracts@1.0.1+20260714',
      });
      if (error) throw error;

      const results = Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
      const enrolled = results.filter((r) => r.status === 'enrolled').length;
      const suppressed = results.filter((r) => r.status === 'suppressed').length;
      const skipped = results.filter((r) => r.status === 'skipped').length;
      return { enrolled, skipped, suppressed, results };
    },
    onSuccess: (result, { campaignId }) => {
      queryClient.invalidateQueries({ queryKey: ['crm-campaign-enrollments', campaignId] });
      queryClient.invalidateQueries({ queryKey: ['crm-campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['crm-client-enrollment'] });

      const parts: string[] = [`${result.enrolled} enrolled`];
      if (result.skipped) parts.push(`${result.skipped} skipped`);
      if (result.suppressed) parts.push(`${result.suppressed} suppressed by policy`);
      toast({
        title: 'Enrollment complete',
        description: parts.join(', '),
      });
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


type EnrollmentAction = 'pause' | 'resume' | 'cancel' | 'responded' | 'restart';

const ACTION_RPC: Record<EnrollmentAction, string> = {
  pause: 'crm_pause_enrollment',
  resume: 'crm_resume_enrollment',
  cancel: 'crm_cancel_enrollment',
  responded: 'crm_mark_enrollment_responded',
  restart: 'crm_restart_enrollment',
};

const ACTION_LABEL: Record<EnrollmentAction, string> = {
  pause: 'paused',
  resume: 'resumed',
  cancel: 'cancelled',
  responded: 'marked as responded',
  restart: 'restarted',
};

/**
 * Controlled enrollment state transitions. Requires a reason.
 * Routes through server-side RPCs that enforce tenant checks,
 * idempotency, audit logging, and cascade-suppression of
 * scheduled step logs. Destructive delete is no longer exposed.
 */
export function useEnrollmentAction() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      enrollmentId,
      action,
      reason,
    }: {
      enrollmentId: string;
      action: EnrollmentAction;
      reason: string;
    }): Promise<Record<string, unknown>> => {
      const rpc = (supabase as unknown as {
        rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
      }).rpc;
      const { data, error } = await rpc(ACTION_RPC[action], {
        p_enrollment_id: enrollmentId,
        p_reason: reason,
        p_idempotency_key: crypto.randomUUID(),
      });
      if (error) throw error;
      const result = (data ?? {}) as Record<string, unknown>;
      if (result.ok === false) {
        throw new Error(String(result.error_code ?? 'unknown_error'));
      }
      return result;
    },
    onSuccess: (_, { action }) => {
      queryClient.invalidateQueries({ queryKey: ['crm-campaign-enrollments'] });
      queryClient.invalidateQueries({ queryKey: ['crm-campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['crm-client-enrollment'] });
      queryClient.invalidateQueries({ queryKey: ['crm-client-enrollment-history'] });
      toast({
        title: 'Enrollment updated',
        description: `Enrollment has been ${ACTION_LABEL[action]}.`,
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

