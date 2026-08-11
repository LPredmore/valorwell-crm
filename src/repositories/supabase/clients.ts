import { supabase } from '@/integrations/supabase/client';
import { Constants, type Database } from '@/integrations/supabase/types';
import type {
  ClientsRepository, ListClientsQuery, Paged,
} from '../types';
import {
  type CanonicalClient,
  type CareCadence,
  type ContactPolicy,
  type EligibilityState,
  type EngagementState,
  type LifecycleStage,
  type ServicePolicy,
  mapDomainLifecycleToDb,
  mapDomainEngagementToDb,
  mapDomainEligibilityToDb,
  mapDomainContactPolicyToDb,
  mapDomainServicePolicyToDb,
  mapDomainCareCadenceToDb,
  mapDomainClosureReasonToDb,
} from '@/domain/canonical';
import {
  CANONICAL_READ_VIEW,
  CONTRACT_VERSION,
  type CanonicalClientState,
} from '@/lib/crm/contracts';
import {
  toCanonicalClientState,
  type CanonicalStateRow,
} from '@/lib/crm/canonicalClientStateAdapter';
import {
  buildCanonicalRpcArgs,
  callCanonicalRpcWithRetry,
  newIdempotencyKey,
  type CanonicalRpcArgsByName,
  type CanonicalRpcName,
} from '@/lib/crm/canonicalRpcTransport';

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

type ClientStateCode = Database['public']['Enums']['state_code_enum'];
type LastContactChannel = NonNullable<CanonicalClient['lastContactChannel']>;

type CanonicalClientLifecycle = Exclude<CanonicalClientState['lifecycle'], 'Lead'>;

const CLIENT_STATE_CODES: ReadonlySet<string> = new Set(Constants.public.Enums.state_code_enum);
const LAST_CONTACT_CHANNELS: ReadonlySet<string> = new Set(['email', 'sms', 'phone', 'note']);

function isClientStateCode(value: string): value is ClientStateCode {
  return CLIENT_STATE_CODES.has(value);
}

function requireClientStateCodes(values: string[]): ClientStateCode[] {
  const states = values.filter(isClientStateCode);
  if (states.length !== values.length) {
    const invalidStates = values.filter((value) => !isClientStateCode(value));
    throw new Error(`Unsupported client state filter: ${invalidStates.join(', ')}`);
  }
  return states;
}

function isLastContactChannel(value: string): value is LastContactChannel {
  return LAST_CONTACT_CHANNELS.has(value);
}

function canonicalLifecycleToDomain(value: CanonicalClientState['lifecycle']): LifecycleStage {
  if (value === 'Lead') {
    throw new Error('Canonical client state is incompatible with the client directory: Lead is not a client lifecycle stage');
  }
  return value;
}

function canonicalEngagementToDomain(value: CanonicalClientState['engagement']): EngagementState {
  switch (value) {
    case 'Normal': return 'Engaged';
    case 'Unresponsive Warm': return 'Warm';
    case 'Unresponsive Cold': return 'Cold';
    case 'Went Dark': return 'Went Dark';
  }
}

function canonicalEligibilityToDomain(value: CanonicalClientState['eligibility']): EligibilityState {
  return value;
}

function canonicalContactPolicyToDomain(value: CanonicalClientState['contact_policy']): ContactPolicy {
  switch (value) {
    case 'Normal': return 'Contact Allowed';
    case 'Do Not Contact': return 'Do Not Contact';
  }
}

function canonicalServicePolicyToDomain(value: CanonicalClientState['service_policy']): ServicePolicy {
  switch (value) {
    case 'Normal': return 'Service Allowed';
    case 'Service Blocked': return 'Service Blocked';
  }
}

function canonicalCareCadenceToDomain(value: CanonicalClientState['care_cadence']): CareCadence {
  switch (value) {
    case 'regular': return 'Regular';
    case 'as_needed': return 'As Needed';
  }
}

export function mapDomainLifecycleToCanonicalRead(value: LifecycleStage): CanonicalClientLifecycle {
  return value;
}

export function mapDomainEngagementToCanonicalRead(value: EngagementState): CanonicalClientState['engagement'] {
  switch (value) {
    case 'Engaged': return 'Normal';
    case 'Warm': return 'Unresponsive Warm';
    case 'Cold': return 'Unresponsive Cold';
    case 'Went Dark': return 'Went Dark';
  }
}

export function mapDomainEligibilityToCanonicalRead(value: EligibilityState): CanonicalClientState['eligibility'] {
  return value;
}

export function mapDomainContactPolicyToCanonicalRead(value: ContactPolicy): CanonicalClientState['contact_policy'] {
  switch (value) {
    case 'Contact Allowed': return 'Normal';
    case 'Do Not Contact': return 'Do Not Contact';
  }
}

export function mapDomainServicePolicyToCanonicalRead(value: ServicePolicy): CanonicalClientState['service_policy'] {
  switch (value) {
    case 'Service Allowed': return 'Normal';
    case 'Service Blocked': return 'Service Blocked';
  }
}

function rowToCanonical(row: ClientRow, state: CanonicalClientState): CanonicalClient {
  if (state.client_id !== row.id) throw new Error('Canonical state unavailable: client_id mismatch');
  if (state.tenant_id !== row.tenant_id) throw new Error('Canonical state unavailable: tenant_id mismatch');

  const tagsArr: string[] = Array.isArray(row.tags)
    ? row.tags.filter((tag): tag is string => typeof tag === 'string')
    : typeof row.tags === 'string' && row.tags
      ? row.tags.split(',').map((tag) => tag.trim()).filter(Boolean)
      : [];

  const risk: CanonicalClient['risk'] = {
    atRisk: state.at_risk.at_risk,
    reasons: [],
    lastEvaluatedAt: state.at_risk.evaluated_at,
    requiredNextAction: state.at_risk.recommended_next_action ?? undefined,
  };

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
    lifecycle: canonicalLifecycleToDomain(state.lifecycle),
    engagement: canonicalEngagementToDomain(state.engagement),
    eligibility: canonicalEligibilityToDomain(state.eligibility),
    contactPolicy: canonicalContactPolicyToDomain(state.contact_policy),
    servicePolicy: canonicalServicePolicyToDomain(state.service_policy),
    careCadence: canonicalCareCadenceToDomain(state.care_cadence),
    risk,
    closure: state.disposition_reason
      ? { closureReason: state.disposition_reason, closedAt: state.disposition_at ?? undefined }
      : undefined,
    lastContactAt: row.last_contact_at ?? undefined,
    lastContactChannel: row.last_contact_channel && isLastContactChannel(row.last_contact_channel)
      ? row.last_contact_channel
      : undefined,
    lastContactDirection: row.last_contact_direction === 'sent'
      ? 'outbound'
      : row.last_contact_direction === 'received'
        ? 'inbound'
        : undefined,
    nextAppointmentAt: state.next_appointment_at ?? undefined,
    nextRequiredAction: state.at_risk.recommended_next_action ?? undefined,
    openTaskCount: 0,
    tags: tagsArr,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}


type ClientListSortKey = keyof CanonicalClient | undefined;

function compareNullable(a: string | number | boolean | undefined, b: string | number | boolean | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

function sortValue(client: CanonicalClient, sortBy: ClientListSortKey): string | number | boolean | undefined {
  switch (sortBy) {
    case 'legalLastName': return client.legalLastName;
    case 'legalFirstName': return client.legalFirstName;
    case 'createdAt': return client.createdAt;
    case 'lastContactAt': return client.lastContactAt;
    case 'lifecycle': return client.lifecycle;
    case 'engagement': return client.engagement;
    case 'eligibility': return client.eligibility;
    case 'contactPolicy': return client.contactPolicy;
    case 'servicePolicy': return client.servicePolicy;
    case 'careCadence': return client.careCadence;
    case 'updatedAt':
    default: return client.updatedAt;
  }
}

export function composeFilterSortAndPageClients(
  canonicalRows: CanonicalStateRow[],
  clientRows: ClientRow[],
  q: ListClientsQuery,
): Paged<CanonicalClient> {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 50;
  const canonicalById = new Map<string, CanonicalClientState>();
  for (const row of canonicalRows) {
    const canonical = toCanonicalClientState(row);
    canonicalById.set(canonical.client_id, canonical);
  }

  const search = q.search?.trim().toLowerCase();
  const rows = clientRows
    .filter((row) => canonicalById.has(row.id))
    .filter((row) => !q.states?.length || (row.pat_state !== null && q.states.includes(row.pat_state)))
    .filter((row) => {
      if (!search) return true;
      return [row.pat_name_f, row.pat_name_l, row.pat_name_preferred, row.email, row.phone]
        .some((value) => value?.toLowerCase().includes(search));
    })
    .map((row) => rowToCanonical(row, canonicalById.get(row.id)!));

  rows.sort((a, b) => {
    const direction = q.sortDir === 'asc' ? 1 : -1;
    const primary = compareNullable(sortValue(a, q.sortBy), sortValue(b, q.sortBy));
    if (primary !== 0) return primary * direction;
    return a.id.localeCompare(b.id);
  });

  const total = rows.length;
  const from = (page - 1) * pageSize;
  return { rows: rows.slice(from, from + pageSize), total, page, pageSize };
}

const CLIENT_LIST_CANDIDATE_ROW_LIMIT = 10_000;

async function fetchAllRows<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  sourceName: string,
): Promise<T[]> {
  // Interim correctness-first materialization guard pending a combined backend
  // read model. Throwing is safer than silently truncating and returning a
  // false total/page when a tenant exceeds the candidate limit.
  const all: T[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    if (from === CLIENT_LIST_CANDIDATE_ROW_LIMIT) {
      const { data, error } = await buildQuery(from, from);
      if (error) throw new Error(error.message);
      if ((data ?? []).length > 0) {
        throw new Error(`${sourceName} candidate row limit exceeded (${CLIENT_LIST_CANDIDATE_ROW_LIMIT}); a combined backend CRM client read model is required`);
      }
      break;
    }
    const { data, error } = await buildQuery(from, from + size - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < size) break;
  }
  return all;
}

async function fetchCanonicalState(clientId: string): Promise<CanonicalClientState> {
  const { data, error } = await supabase
    .from(CANONICAL_READ_VIEW)
    .select('*')
    .eq('client_id', clientId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Canonical state unavailable');
  return toCanonicalClientState(data);
}

async function fetchConcurrencyToken(clientId: string): Promise<string> {
  return (await fetchCanonicalState(clientId)).concurrency_token;
}

async function callRpc<Name extends CanonicalRpcName>(
  name: Name,
  args: CanonicalRpcArgsByName[Name],
): Promise<void> {
  const result = await callCanonicalRpcWithRetry(
    (rpcName, rpcArgs) => supabase.rpc(rpcName, rpcArgs),
    name,
    args,
  );
  if (!result.ok) throw new Error(result.message ?? result.error_code ?? 'Canonical write refused');
}

function rpcArgs<Name extends CanonicalRpcName>(
  base: Omit<CanonicalRpcArgsByName[Name], 'p_concurrency_token' | 'p_idempotency_key' | 'p_contract_version'>,
  concurrencyToken: string,
  idempotencyKey: string,
): CanonicalRpcArgsByName[Name] {
  return buildCanonicalRpcArgs(base, concurrencyToken, idempotencyKey) as CanonicalRpcArgsByName[Name];
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
    const stateCodes = q.states?.length ? requireClientStateCodes(q.states) : undefined;
    let canonicalQuery = supabase
      .from(CANONICAL_READ_VIEW)
      .select('*');

    if (q.lifecycle?.length) canonicalQuery = canonicalQuery.in('lifecycle', q.lifecycle.map(mapDomainLifecycleToCanonicalRead));
    if (q.engagement?.length) canonicalQuery = canonicalQuery.in('engagement', q.engagement.map(mapDomainEngagementToCanonicalRead));
    if (q.eligibility?.length) canonicalQuery = canonicalQuery.in('eligibility', q.eligibility.map(mapDomainEligibilityToCanonicalRead));
    if (q.contactPolicy?.length) canonicalQuery = canonicalQuery.in('contact_policy', q.contactPolicy.map(mapDomainContactPolicyToCanonicalRead));
    if (q.servicePolicy?.length) canonicalQuery = canonicalQuery.in('service_policy', q.servicePolicy.map(mapDomainServicePolicyToCanonicalRead));
    if (q.atRisk !== undefined) canonicalQuery = canonicalQuery.eq('at_risk->>at_risk', String(q.atRisk));
    if (q.assignedClinicianIds?.length) canonicalQuery = canonicalQuery.in('assigned_therapist_id', q.assignedClinicianIds);

    let clientsQuery = supabase
      .from('clients')
      .select(CLIENT_SELECT);

    if (stateCodes?.length) clientsQuery = clientsQuery.in('pat_state', stateCodes);
    if (q.search && q.search.trim()) {
      const s = q.search.trim().replace(/[,()]/g, ' ');
      clientsQuery = clientsQuery.or(
        `pat_name_f.ilike.%${s}%,pat_name_l.ilike.%${s}%,pat_name_preferred.ilike.%${s}%,email.ilike.%${s}%,phone.ilike.%${s}%`,
      );
    }

    const [canonicalRows, clientRows] = await Promise.all([
      fetchAllRows<CanonicalStateRow>((from, to) => canonicalQuery.range(from, to), 'canonical client state'),
      fetchAllRows<ClientRow>((from, to) => clientsQuery.range(from, to), 'client identity'),
    ]);

    return composeFilterSortAndPageClients(canonicalRows, clientRows, q);
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
    const idempotency_key = newIdempotencyKey();
    await callRpc('crm_transition_lifecycle', {
      p_client_id: id,
      p_to_stage: mapDomainLifecycleToDb(next),
      p_reason: note ? `${reason} — ${note}` : reason,
      p_disposition_reason: null,
      p_concurrency_token: concurrency_token,
      p_idempotency_key: idempotency_key,
      p_contract_version: CONTRACT_VERSION,
    });
    return reload(id);
  },

  async updateEngagement(id, next) {
    const concurrency_token = await fetchConcurrencyToken(id);
    const idempotency_key = newIdempotencyKey();
    await callRpc('crm_set_engagement', {
      p_client_id: id,
      p_to_state: mapDomainEngagementToDb(next),
      p_reason: 'ui_update',
      p_concurrency_token: concurrency_token,
      p_idempotency_key: idempotency_key,
      p_contract_version: CONTRACT_VERSION,
    });
    return reload(id);
  },

  async updateEligibility(id, next, note, manualReview) {
    if (next === 'Manual Review' && !manualReview) {
      throw new Error('Manual Review requires an owner, next action, and review due date.');
    }
    const concurrency_token = await fetchConcurrencyToken(id);
    const idempotency_key = newIdempotencyKey();
    await callRpc('crm_set_eligibility', {
      p_client_id: id,
      p_to_state: mapDomainEligibilityToDb(next),
      p_manual_review: manualReview ?? null,
      p_reason: note ?? 'ui_update',
      p_concurrency_token: concurrency_token,
      p_idempotency_key: idempotency_key,
      p_contract_version: CONTRACT_VERSION,
    });
    return reload(id);
  },

  async updateContactPolicy(id, next, reason) {
    const concurrency_token = await fetchConcurrencyToken(id);
    const idempotency_key = newIdempotencyKey();
    await callRpc('crm_set_contact_policy', {
      p_client_id: id,
      p_to_policy: mapDomainContactPolicyToDb(next),
      p_reason: reason,
      p_concurrency_token: concurrency_token,
      p_idempotency_key: idempotency_key,
      p_contract_version: CONTRACT_VERSION,
    });
    return reload(id);
  },

  async updateServicePolicy(id, next, reason) {
    const concurrency_token = await fetchConcurrencyToken(id);
    const idempotency_key = newIdempotencyKey();
    await callRpc('crm_set_service_policy', {
      p_client_id: id,
      p_to_policy: mapDomainServicePolicyToDb(next),
      p_reason: reason,
      p_concurrency_token: concurrency_token,
      p_idempotency_key: idempotency_key,
      p_contract_version: CONTRACT_VERSION,
    });
    return reload(id);
  },

  async updateCareCadence(id, next) {
    const concurrency_token = await fetchConcurrencyToken(id);
    const idempotency_key = newIdempotencyKey();
    await callRpc('crm_set_care_cadence', {
      p_client_id: id,
      p_to_cadence: mapDomainCareCadenceToDb(next),
      p_reason: 'ui_update',
      p_concurrency_token: concurrency_token,
      p_idempotency_key: idempotency_key,
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
    const idempotency_key = newIdempotencyKey();
    if (!info.closureReason) throw new Error('closureReason is required to close a client');
    await callRpc('crm_close_client', {
      p_client_id: id,
      p_disposition_reason: mapDomainClosureReasonToDb(info.closureReason),
      p_reason: info.notes ?? 'ui_close',
      p_concurrency_token: concurrency_token,
      p_idempotency_key: idempotency_key,
      p_contract_version: CONTRACT_VERSION,
    });
    return reload(id);
  },

  async reopen(id, reason) {
    const concurrency_token = await fetchConcurrencyToken(id);
    const idempotency_key = newIdempotencyKey();
    await callRpc('crm_reopen_client', {
      p_client_id: id,
      p_reason: reason,
      p_concurrency_token: concurrency_token,
      p_idempotency_key: idempotency_key,
      p_contract_version: CONTRACT_VERSION,
    });
    return reload(id);
  },

  async assignClinician(id, staffId, reason) {
    if (!staffId?.trim()) throw new Error('assignClinician: staffId is required by the canonical RPC contract');
    const trimmedReason = reason?.trim() ?? '';
    if (trimmedReason.length < 3) throw new Error('assignClinician: reason must be at least 3 characters');
    const concurrency_token = await fetchConcurrencyToken(id);
    const idempotency_key = newIdempotencyKey();
    await callRpc('crm_assign_clinician', {
      p_client_id: id,
      p_staff_id: staffId,
      p_reason: trimmedReason,
      p_concurrency_token: concurrency_token,
      p_idempotency_key: idempotency_key,
      p_contract_version: CONTRACT_VERSION,
    });
    return reload(id);
  },

  async assignOperationsOwner() {
    throw new Error('assignOperationsOwner: no operations-owner column exists on clients yet');
  },
};
