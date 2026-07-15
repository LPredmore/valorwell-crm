import { supabase } from '@/integrations/supabase/client';
import type { Database, Json } from '@/integrations/supabase/types';
import type {
  ClientsRepository, ListClientsQuery, Paged,
} from '../types';
import {
  type CanonicalClient,
  mapDbLifecycleToDomain, mapDomainLifecycleToDb,
  mapDbEngagementToDomain, mapDomainEngagementToDb,
  mapDbEligibilityToDomain, mapDomainEligibilityToDb,
  mapDbContactPolicyToDomain, mapDomainContactPolicyToDb,
  mapDbServicePolicyToDomain, mapDomainServicePolicyToDb,
  mapDbCareCadenceToDomain, mapDomainCareCadenceToDb,
  mapDbClosureReasonToDomain, mapDomainClosureReasonToDb,
} from '@/domain/canonical';
import { CONTRACT_VERSION } from '@/lib/crm/contracts';

const CLIENT_SELECT = `
  id, tenant_id,
  pat_name_f, pat_name_m, pat_name_l, pat_name_preferred,
  email, phone, pat_state, pat_dob,
  tags,
  last_contact_at, last_contact_channel, last_contact_direction,
  created_at, updated_at
`;



type ClientRow = {
  id: string; tenant_id: string; pat_name_f: string | null; pat_name_m: string | null;
  pat_name_l: string | null; pat_name_preferred: string | null; email: string | null;
  phone: string | null; pat_state: string | null; pat_dob: string | null; tags: unknown;
  last_contact_at: string | null; last_contact_channel: string | null; last_contact_direction: string | null;
  created_at: string; updated_at: string;
};

type CanonicalStateRow = Database['public']['Views']['v_client_canonical_state']['Row'];

type CanonicalRpcName =
  | 'crm_transition_lifecycle'
  | 'crm_set_engagement'
  | 'crm_set_contact_policy'
  | 'crm_set_service_policy'
  | 'crm_set_eligibility'
  | 'crm_set_care_cadence'
  | 'crm_assign_clinician'
  | 'crm_close_client'
  | 'crm_reopen_client';

type CanonicalRpcArgsByName = {
  [K in CanonicalRpcName]: Database['public']['Functions'][K]['Args'];
};

function requireCanonicalValue<T>(value: T | null | undefined, field: string): T {
  if (value === null || value === undefined || value === '') {
    throw new Error(`Canonical state unavailable: ${field}`);
  }
  return value;
}

function parseAtRisk(value: Json | null): { atRisk: boolean; atRiskSince?: string; reasons: string[] } {
  if (typeof value === 'boolean') return { atRisk: value, reasons: [] };
  if (typeof value === 'object' && value && !Array.isArray(value)) {
    const record = value as Record<string, Json>;
    return {
      atRisk: record.at_risk === true || record.value === true,
      atRiskSince: typeof record.since === 'string' ? record.since : undefined,
      reasons: Array.isArray(record.reasons) ? record.reasons.filter((r): r is string => typeof r === 'string') : [],
    };
  }
  return { atRisk: false, reasons: [] };
}

function rowToCanonical(row: ClientRow, state: CanonicalStateRow): CanonicalClient {
  if (state.client_id !== row.id) throw new Error('Canonical state unavailable: client_id mismatch');
  const tagsArr: string[] = Array.isArray(row.tags)
    ? row.tags.filter((tag): tag is string => typeof tag === 'string')
    : typeof row.tags === 'string' && row.tags
      ? row.tags.split(',').map((tag) => tag.trim()).filter(Boolean)
      : [];
  const risk = parseAtRisk(state.at_risk);
  const dispositionReason = state.disposition_reason;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    legalFirstName: row.pat_name_f ?? '',
    legalMiddleName: row.pat_name_m ?? undefined,
    legalLastName: row.pat_name_l ?? '',
    preferredName: row.pat_name_preferred ?? undefined,
    dateOfBirth: row.pat_dob ?? undefined,
    email: row.email ?? undefined,
    phone: row.phone ?? undefined,
    state: row.pat_state ?? undefined,
    assignedClinicianId: state.assigned_therapist_id ?? undefined,
    assignedOperationsOwnerId: undefined,
    lifecycle: mapDbLifecycleToDomain(requireCanonicalValue(state.lifecycle, 'lifecycle')),
    engagement: mapDbEngagementToDomain(requireCanonicalValue(state.engagement, 'engagement')),
    eligibility: mapDbEligibilityToDomain(requireCanonicalValue(state.eligibility, 'eligibility')),
    contactPolicy: mapDbContactPolicyToDomain(requireCanonicalValue(state.contact_policy, 'contact_policy')),
    servicePolicy: mapDbServicePolicyToDomain(requireCanonicalValue(state.service_policy, 'service_policy')),
    careCadence: mapDbCareCadenceToDomain(requireCanonicalValue(state.care_cadence, 'care_cadence')),
    risk,
    closure: dispositionReason
      ? { closureReason: mapDbClosureReasonToDomain(dispositionReason), closedAt: state.disposition_at ?? undefined }
      : undefined,
    lastContactAt: row.last_contact_at ?? undefined,
    lastContactChannel: row.last_contact_channel ?? undefined,
    lastContactDirection: row.last_contact_direction === 'sent' ? 'outbound' : row.last_contact_direction === 'received' ? 'inbound' : undefined,
    openTaskCount: 0,
    tags: tagsArr,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function fetchCanonicalState(clientId: string): Promise<CanonicalStateRow> {
  const { data, error } = await supabase.from('v_client_canonical_state').select('*').eq('client_id', clientId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Canonical state unavailable');
  return data;
}

async function fetchConcurrencyToken(clientId: string): Promise<string> {
  return requireCanonicalValue((await fetchCanonicalState(clientId)).concurrency_token, 'concurrency_token');
}

async function callRpc<Name extends CanonicalRpcName>(
  name: Name,
  args: CanonicalRpcArgsByName[Name],
): Promise<void> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  if (data && data.ok === false) {
    throw new Error(data.message ?? data.error_code ?? 'Canonical write refused');
  }
}

async function reload(id: string): Promise<CanonicalClient> {
  const { data, error } = await supabase
    .from('clients')
    .select(CLIENT_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Client not found');
  return rowToCanonical(data, await fetchCanonicalState(id));
}

async function tenantOf(id: string): Promise<string> {
  const { data, error } = await supabase
    .from('clients')
    .select('tenant_id')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.tenant_id) throw new Error('Client not found');
  return data.tenant_id as string;
}

export const supabaseClientsRepository: ClientsRepository = {
  async list(q: ListClientsQuery): Promise<Paged<CanonicalClient>> {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;
    let canonicalQuery = supabase
      .from('v_client_canonical_state')
      .select('*', { count: 'exact' });

    if (q.lifecycle?.length) {
      canonicalQuery = canonicalQuery.in('lifecycle', q.lifecycle.map(mapDomainLifecycleToDb));
    }
    if (q.engagement?.length) {
      canonicalQuery = canonicalQuery.in('engagement', q.engagement.map(mapDomainEngagementToDb));
    }
    if (q.eligibility?.length) {
      canonicalQuery = canonicalQuery.in('eligibility', q.eligibility.map(mapDomainEligibilityToDb));
    }
    if (q.contactPolicy?.length) {
      canonicalQuery = canonicalQuery.in('contact_policy', q.contactPolicy.map(mapDomainContactPolicyToDb));
    }
    if (q.servicePolicy?.length) {
      canonicalQuery = canonicalQuery.in('service_policy', q.servicePolicy.map(mapDomainServicePolicyToDb));
    }
    if (q.atRisk !== undefined) canonicalQuery = canonicalQuery.eq('at_risk->>at_risk', String(q.atRisk));
    if (q.assignedClinicianIds?.length) canonicalQuery = canonicalQuery.in('assigned_therapist_id', q.assignedClinicianIds);

    const from = (page - 1) * pageSize;
    canonicalQuery = canonicalQuery.order('updated_at', { ascending: q.sortDir === 'asc' }).range(from, from + pageSize - 1);

    const { data: canonicalRows, count, error: canonicalError } = await canonicalQuery;
    if (canonicalError) throw new Error(canonicalError.message);
    const canonicalById = new Map((canonicalRows ?? []).map((row) => [requireCanonicalValue(row.client_id, 'client_id'), row]));
    const ids = [...canonicalById.keys()];

    let query = supabase
      .from('clients')
      .select(CLIENT_SELECT)
      .in('id', ids);

    if (q.states?.length) query = query.in('pat_state', q.states);

    if (q.search && q.search.trim()) {
      const s = q.search.trim().replace(/[,()]/g, ' ');
      query = query.or(
        `pat_name_f.ilike.%${s}%,pat_name_l.ilike.%${s}%,pat_name_preferred.ilike.%${s}%,email.ilike.%${s}%,phone.ilike.%${s}%`,
      );
    }

    const sortCol = ({
      updatedAt: 'updated_at',
      createdAt: 'created_at',
      lastContactAt: 'last_contact_at',
      legalLastName: 'pat_name_l',
      legalFirstName: 'pat_name_f',
    } as Record<string, string>)[q.sortBy as string] ?? 'updated_at';
    query = query.order(sortCol, { ascending: q.sortDir === 'asc' });

    const { data, error } = ids.length ? await query : { data: [], error: null };
    if (error) throw new Error(error.message);
    return {
      rows: (data ?? []).map((row) => rowToCanonical(row, canonicalById.get(row.id)!)),
      total: count ?? 0,
      page,
      pageSize,
    };
  },

  async get(id: string) {
    const { data, error } = await supabase
      .from('clients')
      .select(CLIENT_SELECT)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? rowToCanonical(data, await fetchCanonicalState(id)) : null;
  },

  async updateLifecycle(id, next, reason, note) {
    const concurrency_token = await fetchConcurrencyToken(id);
    await callRpc('crm_transition_lifecycle', {
      p_client_id: id,
      p_to_stage: mapDomainLifecycleToDb(next),
      p_reason: note ? `${reason} — ${note}` : reason,
      p_disposition_reason: null,
      p_concurrency_token: concurrency_token,
      p_idempotency_key: crypto.randomUUID(),
      p_contract_version: CONTRACT_VERSION,
    });
    return reload(id);
  },

  async updateEngagement(id, next) {
    const concurrency_token = await fetchConcurrencyToken(id);
    await callRpc('crm_set_engagement', {
      p_client_id: id,
      p_to_state: mapDomainEngagementToDb(next),
      p_reason: 'ui_update',
      p_concurrency_token: concurrency_token,
      p_idempotency_key: crypto.randomUUID(),
      p_contract_version: CONTRACT_VERSION,
    });
    return reload(id);
  },

  async updateEligibility(id, next, note) {
    const concurrency_token = await fetchConcurrencyToken(id);
    await callRpc('crm_set_eligibility', {
      p_client_id: id,
      p_to_state: mapDomainEligibilityToDb(next),
      p_manual_review: null,
      p_reason: note ?? 'ui_update',
      p_concurrency_token: concurrency_token,
      p_idempotency_key: crypto.randomUUID(),
      p_contract_version: CONTRACT_VERSION,
    });
    return reload(id);
  },

  async updateContactPolicy(id, next, reason) {
    const concurrency_token = await fetchConcurrencyToken(id);
    await callRpc('crm_set_contact_policy', {
      p_client_id: id,
      p_to_policy: mapDomainContactPolicyToDb(next),
      p_reason: reason,
      p_concurrency_token: concurrency_token,
      p_idempotency_key: crypto.randomUUID(),
      p_contract_version: CONTRACT_VERSION,
    });
    return reload(id);
  },

  async updateServicePolicy(id, next, reason) {
    const concurrency_token = await fetchConcurrencyToken(id);
    await callRpc('crm_set_service_policy', {
      p_client_id: id,
      p_to_policy: mapDomainServicePolicyToDb(next),
      p_reason: reason,
      p_concurrency_token: concurrency_token,
      p_idempotency_key: crypto.randomUUID(),
      p_contract_version: CONTRACT_VERSION,
    });
    return reload(id);
  },

  async updateCareCadence(id, next) {
    const concurrency_token = await fetchConcurrencyToken(id);
    await callRpc('crm_set_care_cadence', {
      p_client_id: id,
      p_to_cadence: mapDomainCareCadenceToDb(next),
      p_reason: 'ui_update',
      p_concurrency_token: concurrency_token,
      p_idempotency_key: crypto.randomUUID(),
      p_contract_version: CONTRACT_VERSION,
    });
    return reload(id);
  },

  async updateRisk() {
    // Risk state is derived server-side; no client-facing RPC exists on
    // contract 1.0.1. Fail-closed rather than silently no-op.
    throw new Error(
      'updateRisk: risk state is derived server-side under contract 1.0.1 and cannot be set from the CRM UI',
    );
  },

  async close(id, info) {
    const concurrency_token = await fetchConcurrencyToken(id);
    if (!info.closureReason) throw new Error('closureReason is required to close a client');
    await callRpc('crm_close_client', {
      p_client_id: id,
      p_disposition_reason: mapDomainClosureReasonToDb(info.closureReason),
      p_reason: info.notes ?? 'ui_close',
      p_concurrency_token: concurrency_token,
      p_idempotency_key: crypto.randomUUID(),
      p_contract_version: CONTRACT_VERSION,
    });
    return reload(id);
  },

  async reopen(id, reason) {
    const concurrency_token = await fetchConcurrencyToken(id);
    await callRpc('crm_reopen_client', {
      p_client_id: id,
      p_reason: reason,
      p_concurrency_token: concurrency_token,
      p_idempotency_key: crypto.randomUUID(),
      p_contract_version: CONTRACT_VERSION,
    });
    return reload(id);
  },

  async assignClinician(id, staffId) {
    const concurrency_token = await fetchConcurrencyToken(id);
    await callRpc('crm_assign_clinician', {
      p_client_id: id,
      p_staff_id: staffId,
      p_reason: 'ui_assign',
      p_concurrency_token: concurrency_token,
      p_idempotency_key: crypto.randomUUID(),
      p_contract_version: CONTRACT_VERSION,
    });
    return reload(id);
  },

  async assignOperationsOwner() {
    throw new Error('assignOperationsOwner: no operations-owner column exists on clients yet');
  },
};

