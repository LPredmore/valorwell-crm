import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
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

export type CanonicalReadStatus = 'ok' | 'CONTRACT_NOT_DEPLOYED' | 'empty';

export interface CanonicalReadResult<T> {
  status: CanonicalReadStatus;
  data: T | null;
  message?: string;
}


type CanonicalStateRow = Database['public']['Views']['v_client_canonical_state']['Row'];

function requireString(value: string | null, field: string): string {
  if (!value) {
    throw new Error(`Canonical state missing required ${field}`);
  }
  return value;
}

function toCanonicalClientState(row: CanonicalStateRow): CanonicalClientState {
  return {
    client_id: requireString(row.client_id, 'client_id'),
    tenant_id: requireString(row.tenant_id, 'tenant_id'),
    contract_version: requireString(row.contract_version, 'contract_version'),
    lifecycle: requireString(row.lifecycle, 'lifecycle'),
    engagement: requireString(row.engagement, 'engagement'),
    at_risk: row.at_risk,
    eligibility: requireString(row.eligibility, 'eligibility'),
    eligibility_manual_review: row.eligibility_manual_review,
    contact_policy: requireString(row.contact_policy, 'contact_policy'),
    service_policy: requireString(row.service_policy, 'service_policy'),
    care_cadence: row.care_cadence,
    disposition_reason: row.disposition_reason,
    disposition_at: row.disposition_at,
    assigned_therapist_id: row.assigned_therapist_id,
    next_appointment_at: row.next_appointment_at,
    provider_demand_state: row.provider_demand_state,
    concurrency_token: requireString(row.concurrency_token, 'concurrency_token'),
    updated_at: row.updated_at,
  };
}

function classifyError(message: string): CanonicalReadStatus {
  if (
    /relation .* does not exist/i.test(message) ||
    /could not find the table/i.test(message) ||
    /PGRST20[12]/i.test(message)
  ) {
    return 'CONTRACT_NOT_DEPLOYED';
  }
  return 'CONTRACT_NOT_DEPLOYED';
}

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
        .select(CANONICAL_COLUMNS)
        .eq('tenant_id', tenantId)
        .eq('client_id', clientId)
        .maybeSingle();

      if (error) {
        console.warn(`[canonical] ${CANONICAL_READ_VIEW} unavailable:`, error.message);
        return {
          status: classifyError(error.message),
          data: null,
          message: error.message,
        };
      }
      return { status: data ? 'ok' : 'empty', data: data ? toCanonicalClientState(data) : null };
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
        .select(CANONICAL_COLUMNS)
        .eq('tenant_id', tenantId)
        .in('client_id', clientIds);

      if (error) {
        console.warn(`[canonical] ${CANONICAL_READ_VIEW} unavailable:`, error.message);
        return {
          status: classifyError(error.message),
          data: null,
          message: error.message,
        };
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
