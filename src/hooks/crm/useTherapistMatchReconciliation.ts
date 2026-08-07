import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type TherapistMatchWorkType = 'match' | 'legacy_relationship';
export type TherapistMatchWorkState =
  | 'pending_clinician_acceptance'
  | 'pending_first_appointment'
  | 'legacy_review';

export interface TherapistMatchWorkRow {
  workType: TherapistMatchWorkType;
  id: string;
  matchId: string | null;
  relationshipId: string | null;
  clientId: string;
  clientDisplayName: string;
  clientEmail: string | null;
  clientState: string | null;
  lifecycleStage: string;
  staffId: string;
  staffDisplayName: string;
  state: TherapistMatchWorkState;
  schedulingBranch: 'self_schedule' | 'therapist_led' | null;
  source: string;
  openedAt: string;
  expiresAt: string | null;
  version: number;
  staffStatus: string;
  staffAcceptingNewClients: boolean;
  appointmentCount: number;
  documentedAppointmentCount: number;
  signedNoteCount: number;
  activeTreatmentPlan: boolean;
  latestCareAt: string | null;
  recommendedAction: string;
}

export interface TherapistMatchWorkResult {
  rows: TherapistMatchWorkRow[];
  total: number;
  page: number;
  pageSize: number;
  scope: 'active' | 'pending' | 'legacy' | 'all';
  isAdmin: boolean;
  contractVersion: string;
}

interface ActionResult {
  success: boolean;
  idempotent: boolean;
  relationshipId?: string;
  state?: string;
  taskId?: string;
}

async function rpc<T>(name: string, params: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name as never, params as never);
  if (error) throw error;
  return data as T;
}

const workKey = ['crm-therapist-match-work'] as const;

export function useTherapistMatchReconciliation(params: {
  page?: number;
  pageSize?: number;
  scope?: 'active' | 'pending' | 'legacy' | 'all';
  search?: string;
}) {
  return useQuery({
    queryKey: [...workKey, params],
    queryFn: () => rpc<TherapistMatchWorkResult>('staff_list_therapist_match_work', {
      p_page: params.page ?? 1,
      p_page_size: params.pageSize ?? 100,
      p_scope: params.scope ?? 'legacy',
      p_search: params.search?.trim() || null,
    }),
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });
}

function useDecision<TVariables>(
  mutationFn: (variables: TVariables) => Promise<ActionResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: workKey }),
        queryClient.invalidateQueries({ queryKey: ['crm-tasks'] }),
        queryClient.invalidateQueries({ queryKey: ['crm-exceptions'] }),
        queryClient.invalidateQueries({ queryKey: ['crm-clients'] }),
      ]);
    },
  });
}

export function useConfirmLegacyRelationship() {
  return useDecision<{
    relationshipId: string;
    priorVersion: number;
    reason: string;
    clientActionId: string;
  }>(({ relationshipId, priorVersion, reason, clientActionId }) =>
    rpc<ActionResult>('confirm_legacy_therapist_relationship', {
      p_relationship_id: relationshipId,
      p_reason: reason,
      p_prior_version: priorVersion,
      p_client_action_id: clientActionId,
    }),
  );
}

export function useRejectLegacyRelationship() {
  return useDecision<{
    relationshipId: string;
    priorVersion: number;
    reason: string;
    clientActionId: string;
  }>(({ relationshipId, priorVersion, reason, clientActionId }) =>
    rpc<ActionResult>('reject_legacy_therapist_relationship', {
      p_relationship_id: relationshipId,
      p_reason: reason,
      p_prior_version: priorVersion,
      p_client_action_id: clientActionId,
    }),
  );
}
