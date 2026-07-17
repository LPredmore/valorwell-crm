import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface LifecycleTransitionOption {
  stage: string;
  allowed: boolean;
  reason_code: string | null;
  message: string | null;
}

export interface AllowedLifecycleTransitions {
  currentStage: string;
  transitions: LifecycleTransitionOption[];
}

export function allowedLifecycleTransitionsKey(clientId: string) {
  return ['crm', 'allowed-lifecycle-transitions', clientId] as const;
}

export function useAllowedLifecycleTransitions(clientId: string | undefined) {
  return useQuery({
    queryKey: allowedLifecycleTransitionsKey(clientId ?? ''),
    enabled: !!clientId,
    queryFn: async (): Promise<AllowedLifecycleTransitions> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)('crm_allowed_lifecycle_transitions', {
        p_client_id: clientId,
      });
      if (error) throw new Error(error.message);
      const payload = data as {
        ok: boolean;
        error_code?: string;
        current_stage?: string;
        transitions?: LifecycleTransitionOption[];
      };
      if (!payload?.ok) {
        throw new Error(payload?.error_code ?? 'allowed_transitions_unavailable');
      }
      return {
        currentStage: payload.current_stage ?? '',
        transitions: payload.transitions ?? [],
      };
    },
  });
}
