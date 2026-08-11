import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCrmAuth } from './useCrmAuth';
import {
  CANONICAL_READ_VIEW,
  CONTRACT_VERSION,
  type CanonicalClientState,
} from '@/lib/crm/contracts';
import {
  classifyError,
  resolveCanonicalRead,
  toCanonicalClientState,
  type CanonicalReadResult,
} from '@/lib/crm/canonicalClientStateAdapter';

export {
  classifyError,
  resolveCanonicalRead,
  toCanonicalClientState,
} from '@/lib/crm/canonicalClientStateAdapter';
export type {
  CanonicalReadResult,
  CanonicalReadStatus,
} from '@/lib/crm/canonicalClientStateAdapter';

/**
 * Reads the authoritative canonical state for a client.
 * Never reads legacy status columns. Never derives lifecycle/engagement/at-risk client-side.
 * Fail-closed: returns explicit CONTRACT_NOT_DEPLOYED status when the backend
 * view is missing, instead of silently returning null.
 */
export function useCanonicalClientState(clientId: string | undefined | null) {
  const { tenantId, isAuthenticated } = useCrmAuth();

  return useQuery({
    queryKey: ['canonical-client-state', tenantId, clientId, CONTRACT_VERSION],
    enabled: isAuthenticated && !!tenantId && !!clientId,
    queryFn: async (): Promise<CanonicalReadResult<CanonicalClientState>> => {
      const { data, error } = await supabase
        .from(CANONICAL_READ_VIEW)
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('client_id', clientId)
        .maybeSingle();

      if (error) console.warn(`[canonical] ${CANONICAL_READ_VIEW} unavailable:`, error.message);
      return resolveCanonicalRead(data, error);
    },
  });
}

/**
 * Batch read for list/kanban surfaces.
 */
export function useCanonicalClientStates(clientIds: string[]) {
  const { tenantId, isAuthenticated } = useCrmAuth();
  const key = clientIds.slice().sort().join(',');

  return useQuery({
    queryKey: ['canonical-client-states', tenantId, key, CONTRACT_VERSION],
    enabled: isAuthenticated && !!tenantId && clientIds.length > 0,
    queryFn: async (): Promise<CanonicalReadResult<Record<string, CanonicalClientState>>> => {
      const { data, error } = await supabase
        .from(CANONICAL_READ_VIEW)
        .select('*')
        .eq('tenant_id', tenantId)
        .in('client_id', clientIds);

      if (error) {
        console.warn(`[canonical] ${CANONICAL_READ_VIEW} unavailable:`, error.message);
        const status = classifyError(error.message);
        if (status) return { status, data: null, message: error.message };
        throw new Error(error.message);
      }

      const out: Record<string, CanonicalClientState> = {};
      for (const row of data ?? []) {
        const canonical = toCanonicalClientState(row);
        out[canonical.client_id] = canonical;
      }
      return { status: 'ok', data: out };
    },
  });
}
