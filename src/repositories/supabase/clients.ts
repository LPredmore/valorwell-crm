import { supabase } from '@/integrations/supabase/client';
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
  primary_staff_id, tags,
  lifecycle_stage, lifecycle_stage_changed_at,
  engagement_state, engagement_state_changed_at,
  eligibility_state, eligibility_state_changed_at,
  contact_policy, contact_policy_changed_at,
  service_policy, service_policy_changed_at,
  care_cadence, care_cadence_changed_at,
  at_risk, at_risk_since,
  closure_reason, closed_at,
  last_contact_at, last_contact_channel, last_contact_direction,
  created_at, updated_at
`;

type Row = Record<string, any>;

function tokenFor(id: string, updatedAt: string | null | undefined): string {
  // Deterministic pseudo-uuid derived from id+updated_at; matches the SQL
  // COALESCE fallback in v_client_canonical_state.
  // We ask the view for the actual concurrency_token (which may come from meta).
  return `${id}:${updatedAt ?? ''}`;
}

async function fetchConcurrencyToken(clientId: string): Promise<string> {
  const { data, error } = await (supabase as any)
    .from('v_client_canonical_state')
    .select('concurrency_token')
    .eq('client_id', clientId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.concurrency_token) throw new Error('Concurrency token unavailable');
  return data.concurrency_token as string;
}

function rowToCanonical(row: Row): CanonicalClient {
  const tagsArr: string[] = Array.isArray(row.tags)
    ? row.tags
    : typeof row.tags === 'string' && row.tags
      ? row.tags.split(',').map((s: string) => s.trim()).filter(Boolean)
      : [];
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
    assignedClinicianId: row.primary_staff_id ?? undefined,
    assignedOperationsOwnerId: undefined,
    lifecycle: mapDbLifecycleToDomain(row.lifecycle_stage),
    engagement: mapDbEngagementToDomain(row.engagement_state),
    eligibility: mapDbEligibilityToDomain(row.eligibility_state),
    contactPolicy: mapDbContactPolicyToDomain(row.contact_policy),
    servicePolicy: mapDbServicePolicyToDomain(row.service_policy),
    careCadence: mapDbCareCadenceToDomain(row.care_cadence),
    risk: {
      atRisk: !!row.at_risk,
      atRiskSince: row.at_risk_since ?? undefined,
      reasons: [],
    },
    closure: row.closure_reason
      ? {
          closureReason: mapDbClosureReasonToDomain(row.closure_reason),
          closedAt: row.closed_at ?? undefined,
        }
      : undefined,
    lastContactAt: row.last_contact_at ?? undefined,
    lastContactChannel: row.last_contact_channel ?? undefined,
    lastContactDirection:
      row.last_contact_direction === 'sent' ? 'outbound'
      : row.last_contact_direction === 'received' ? 'inbound'
      : undefined,
    openTaskCount: 0,
    tags: tagsArr,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function callRpc(
  name: string,
  args: Record<string, unknown>,
): Promise<void> {
  const { data, error } = await (supabase as any).rpc(name, args);
  if (error) throw new Error(error.message);
  if (data && data.ok === false) {
    throw new Error(data.message ?? data.error_code ?? 'Canonical write refused');
  }
}

async function reload(id: string): Promise<CanonicalClient> {
  const { data, error } = await (supabase as any)
    .from('clients')
    .select(CLIENT_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Client not found');
  return rowToCanonical(data);
}

async function tenantOf(id: string): Promise<string> {
  const { data, error } = await (supabase as any)
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
    let query = (supabase as any)
      .from('clients')
      .select(CLIENT_SELECT, { count: 'exact' });

    if (q.lifecycle?.length) {
      query = query.in('lifecycle_stage', q.lifecycle.map(mapDomainLifecycleToDb));
    }
    if (q.engagement?.length) {
      query = query.in('engagement_state', q.engagement.map(mapDomainEngagementToDb));
    }
    if (q.eligibility?.length) {
      query = query.in('eligibility_state', q.eligibility.map(mapDomainEligibilityToDb));
    }
    if (q.contactPolicy?.length) {
      query = query.in('contact_policy', q.contactPolicy.map(mapDomainContactPolicyToDb));
    }
    if (q.servicePolicy?.length) {
      query = query.in('service_policy', q.servicePolicy.map(mapDomainServicePolicyToDb));
    }
    if (q.atRisk !== undefined) query = query.eq('at_risk', q.atRisk);
    if (q.states?.length) query = query.in('pat_state', q.states);
    if (q.assignedClinicianIds?.length) query = query.in('primary_staff_id', q.assignedClinicianIds);

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

    const from = (page - 1) * pageSize;
    query = query.range(from, from + pageSize - 1);

    const { data, count, error } = await query;
    if (error) throw new Error(error.message);
    return {
      rows: (data ?? []).map(rowToCanonical),
      total: count ?? 0,
      page,
      pageSize,
    };
  },

  async get(id: string) {
    const { data, error } = await (supabase as any)
      .from('clients')
      .select(CLIENT_SELECT)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? rowToCanonical(data) : null;
  },

  async updateLifecycle(id, next, reason) {
    const tenant_id = await tenantOf(id);
    const concurrency_token = await fetchConcurrencyToken(id);
    await callRpc('transition_client_lifecycle', {
      client_id: id,
      tenant_id,
      to_stage: mapDomainLifecycleToDb(next),
      reason,
      concurrency_token,
      contract_version: CONTRACT_VERSION,
    });
    return reload(id);
  },

  async updateEngagement(id, next) {
    const tenant_id = await tenantOf(id);
    const concurrency_token = await fetchConcurrencyToken(id);
    await callRpc('set_client_engagement_state', {
      client_id: id, tenant_id,
      to_state: mapDomainEngagementToDb(next),
      reason: 'ui_update',
      concurrency_token, contract_version: CONTRACT_VERSION,
    });
    return reload(id);
  },

  async updateEligibility(id, next, note) {
    const tenant_id = await tenantOf(id);
    const concurrency_token = await fetchConcurrencyToken(id);
    await callRpc('set_client_eligibility_state', {
      client_id: id, tenant_id,
      to_state: mapDomainEligibilityToDb(next),
      reason: note ?? 'ui_update',
      concurrency_token, contract_version: CONTRACT_VERSION,
    });
    return reload(id);
  },

  async updateContactPolicy(id, next, reason) {
    const tenant_id = await tenantOf(id);
    const concurrency_token = await fetchConcurrencyToken(id);
    await callRpc('set_client_contact_policy', {
      client_id: id, tenant_id,
      to_policy: mapDomainContactPolicyToDb(next),
      reason, concurrency_token, contract_version: CONTRACT_VERSION,
    });
    return reload(id);
  },

  async updateServicePolicy(id, next, reason) {
    const tenant_id = await tenantOf(id);
    const concurrency_token = await fetchConcurrencyToken(id);
    await callRpc('set_client_service_policy', {
      client_id: id, tenant_id,
      to_policy: mapDomainServicePolicyToDb(next),
      reason, concurrency_token, contract_version: CONTRACT_VERSION,
    });
    return reload(id);
  },

  async updateCareCadence(id, next) {
    const tenant_id = await tenantOf(id);
    const concurrency_token = await fetchConcurrencyToken(id);
    await callRpc('set_client_care_cadence', {
      client_id: id, tenant_id,
      to_cadence: mapDomainCareCadenceToDb(next),
      reason: 'ui_update',
      concurrency_token, contract_version: CONTRACT_VERSION,
    });
    return reload(id);
  },

  async updateRisk(id) {
    // At-risk marking is currently derived at the DB level via
    // mark_at_risk_clients. Manual override RPC will be added in a later
    // workstream. Reload current row so the UI shows authoritative state.
    return reload(id);
  },

  async close(id, info) {
    const tenant_id = await tenantOf(id);
    const concurrency_token = await fetchConcurrencyToken(id);
    if (!info.closureReason) throw new Error('closureReason is required to close a client');
    await callRpc('set_client_disposition', {
      client_id: id, tenant_id,
      disposition_reason: mapDomainClosureReasonToDb(info.closureReason),
      reason: info.notes ?? 'ui_close',
      concurrency_token, contract_version: CONTRACT_VERSION,
    });
    return reload(id);
  },

  async reopen(id, reason) {
    const tenant_id = await tenantOf(id);
    const concurrency_token = await fetchConcurrencyToken(id);
    await callRpc('transition_client_lifecycle', {
      client_id: id, tenant_id,
      to_stage: 'intake',
      reason,
      concurrency_token, contract_version: CONTRACT_VERSION,
    });
    return reload(id);
  },

  async assignClinician(id, staffId) {
    // Assignment is not yet covered by a canonical RPC; write via table
    // requires appropriate privileges. Emit an audit-visible warning instead.
    throw new Error('assignClinician: canonical assignment RPC not implemented yet');
  },

  async assignOperationsOwner() {
    throw new Error('assignOperationsOwner: canonical assignment RPC not implemented yet');
  },
};
