import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCrmAuth } from './useCrmAuth';
import {
  CANONICAL_READ_VIEW,
  CONTRACT_VERSION,
  type CanonicalClientState,
} from '@/lib/crm/contracts';

const CANONICAL_COLUMNS = [
  'client_id',
  'tenant_id',
  'contract_version',
  'lifecycle',
  'engagement',
  'at_risk',
  'eligibility',
  'eligibility_manual_review',
  'contact_policy',
  'service_policy',
  'care_cadence',
  'disposition_reason',
  'disposition_at',
  'assigned_therapist_id',
  'next_appointment_at',
  'provider_demand_state',
  'concurrency_token',
  'updated_at',
].join(',');

/**
 * Reads the authoritative canonical state for a client.
 * Never reads pat_status. Never derives lifecycle/engagement/at-risk client-side.
 */
export function useCanonicalClientState(clientId: string | undefined | null) {
  const { tenantId, isAuthenticated } = useCrmAuth();

  return useQuery({
    queryKey: ['canonical-client-state', tenantId, clientId, CONTRACT_VERSION],
    enabled: isAuthenticated && !!tenantId && !!clientId,
    queryFn: async (): Promise<CanonicalClientState | null> => {
      const { data, error } = await (supabase as any)
        .from(CANONICAL_READ_VIEW)
        .select(CANONICAL_COLUMNS)
        .eq('tenant_id', tenantId)
        .eq('client_id', clientId)
        .maybeSingle();

      if (error) {
        // Canonical view not yet published — surface safe empty state.
        console.warn(`[canonical] ${CANONICAL_READ_VIEW} unavailable:`, error.message);
        return null;
      }
      return data as CanonicalClientState | null;
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
    queryFn: async (): Promise<Record<string, CanonicalClientState>> => {
      const { data, error } = await (supabase as any)
        .from(CANONICAL_READ_VIEW)
        .select(CANONICAL_COLUMNS)
        .eq('tenant_id', tenantId)
        .in('client_id', clientIds);

      if (error) {
        console.warn(`[canonical] ${CANONICAL_READ_VIEW} unavailable:`, error.message);
        return {};
      }
      const out: Record<string, CanonicalClientState> = {};
      for (const row of (data ?? []) as CanonicalClientState[]) {
        out[row.client_id] = row;
      }
      return out;
    },
  });
}
