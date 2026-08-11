import { describe, expect, it } from 'vitest';
import {
  composeFilterSortAndPageClients,
  mapDomainContactPolicyToCanonicalRead,
  mapDomainEligibilityToCanonicalRead,
  mapDomainEngagementToCanonicalRead,
  mapDomainLifecycleToCanonicalRead,
  mapDomainServicePolicyToCanonicalRead,
} from '@/repositories/supabase/clients';
import type { Database } from '@/integrations/supabase/types';
import { CONTRACT_VERSION } from '@/lib/crm/contracts';

type CanonicalRow = Database['public']['Views']['v_client_canonical_state']['Row'];

function canonical(id: string, overrides: Partial<CanonicalRow> = {}): CanonicalRow {
  return {
    client_id: id,
    tenant_id: 't1',
    lifecycle: 'Scheduled',
    engagement: 'Normal',
    eligibility: 'Eligible',
    contact_policy: 'Normal',
    service_policy: 'Normal',
    care_cadence: 'regular',
    assigned_therapist_id: null,
    at_risk: {
      at_risk: false,
      evaluated_at: '2026-01-01T00:00:00Z',
      recommended_next_action: null,
      event_version: `evt-${id}`,
      reason: null,
    },
    concurrency_token: `tok-${id}`,
    contract_version: CONTRACT_VERSION,
    disposition_at: null,
    disposition_reason: null,
    eligibility_manual_review: null,
    next_appointment_at: null,
    provider_demand_state: 'none',
    updated_at: `2026-01-${id.padStart(2, '0')}T00:00:00Z`,
    ...overrides,
  };
}

function client(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    tenant_id: 't1',
    pat_name_f: `First${id}`,
    pat_name_m: null,
    pat_name_l: `Last${id}`,
    pat_name_preferred: null,
    email: `client${id}@example.com`,
    phone: null,
    pat_state: 'CA',
    pat_dob: null,
    tags: [],
    last_contact_at: null,
    last_contact_channel: null,
    last_contact_direction: null,
    created_at: `2026-01-${id.padStart(2, '0')}T00:00:00Z`,
    updated_at: `2026-02-${id.padStart(2, '0')}T00:00:00Z`,
    lifecycle_stage: 'prospect',
    engagement_state: 'cold',
    ...overrides,
  };
}

describe('canonical client list composition', () => {
  it('search filtering across more than one canonical page happens before pagination', () => {
    const canonicalRows = Array.from({ length: 6 }, (_, i) => canonical(String(i + 1)));
    const clientRows = canonicalRows.map((row, i) => client(String(row.client_id), { pat_name_l: i >= 3 ? 'Needle' : 'Other' }));
    const result = composeFilterSortAndPageClients(canonicalRows, clientRows, { search: 'Needle', page: 1, pageSize: 2, sortBy: 'legalFirstName', sortDir: 'asc' });
    expect(result.total).toBe(3);
    expect(result.rows.map((row) => row.id)).toEqual(['4', '5']);
  });

  it('state filtering across more than one canonical page happens before pagination', () => {
    const canonicalRows = Array.from({ length: 6 }, (_, i) => canonical(String(i + 1)));
    const clientRows = canonicalRows.map((row, i) => client(String(row.client_id), { pat_state: i >= 3 ? 'WA' : 'CA' }));
    const result = composeFilterSortAndPageClients(canonicalRows, clientRows, { states: ['WA'], page: 1, pageSize: 2, sortBy: 'legalFirstName', sortDir: 'asc' });
    expect(result.total).toBe(3);
    expect(result.rows.map((row) => row.id)).toEqual(['4', '5']);
  });

  it('reports the final total after canonical and identity filters intersect', () => {
    const canonicalRows = [canonical('1'), canonical('2')];
    const clientRows = [client('1', { pat_state: 'WA' }), client('2', { pat_state: 'CA' }), client('3', { pat_state: 'WA' })];
    const result = composeFilterSortAndPageClients(canonicalRows, clientRows, { states: ['WA'] });
    expect(result.total).toBe(1);
    expect(result.rows[0].id).toBe('1');
  });

  it('sorts names globally across multiple pages', () => {
    const canonicalRows = ['1', '2', '3', '4'].map((id) => canonical(id));
    const clientRows = [client('1', { pat_name_l: 'Zulu' }), client('2', { pat_name_l: 'Alpha' }), client('3', { pat_name_l: 'Echo' }), client('4', { pat_name_l: 'Bravo' })];
    const result = composeFilterSortAndPageClients(canonicalRows, clientRows, { sortBy: 'legalLastName', sortDir: 'asc', page: 2, pageSize: 2 });
    expect(result.rows.map((row) => row.legalLastName)).toEqual(['Echo', 'Zulu']);
  });

  it('sorts updated dates globally', () => {
    const canonicalRows = ['1', '2', '3'].map((id) => canonical(id));
    const clientRows = [client('1', { updated_at: '2026-03-01T00:00:00Z' }), client('2', { updated_at: '2026-03-03T00:00:00Z' }), client('3', { updated_at: '2026-03-02T00:00:00Z' })];
    const result = composeFilterSortAndPageClients(canonicalRows, clientRows, { sortBy: 'updatedAt', sortDir: 'desc' });
    expect(result.rows.map((row) => row.id)).toEqual(['2', '3', '1']);
  });

  it('fills a page with later matches instead of filtering a pre-paginated canonical page', () => {
    const canonicalRows = Array.from({ length: 5 }, (_, i) => canonical(String(i + 1)));
    const clientRows = canonicalRows.map((row, i) => client(String(row.client_id), { pat_state: i === 0 ? 'CA' : 'WA' }));
    const result = composeFilterSortAndPageClients(canonicalRows, clientRows, { states: ['WA'], page: 1, pageSize: 3, sortBy: 'legalFirstName', sortDir: 'asc' });
    expect(result.rows.map((row) => row.id)).toEqual(['2', '3', '4']);
    expect(result.total).toBe(4);
  });

  it('maps deployed canonical state into CRM domain values', () => {
    const result = composeFilterSortAndPageClients(
      [canonical('1', {
        lifecycle: 'Early Care',
        engagement: 'Unresponsive Warm',
        eligibility: 'Coverage Issue',
        contact_policy: 'Normal',
        service_policy: 'Normal',
        care_cadence: 'regular',
        next_appointment_at: '2026-08-20T15:00:00Z',
        at_risk: {
          at_risk: true,
          evaluated_at: '2026-08-10T15:00:00Z',
          recommended_next_action: 'Call client',
          event_version: 'evt-1',
          reason: 'follow_up_gap',
        },
      })],
      [client('1', { lifecycle_stage: 'closed', engagement_state: 'cold' })],
      {},
    );

    expect(result.rows[0]).toMatchObject({
      lifecycle: 'Early Care',
      engagement: 'Warm',
      eligibility: 'Coverage Issue',
      contactPolicy: 'Contact Allowed',
      servicePolicy: 'Service Allowed',
      careCadence: 'Regular',
      nextAppointmentAt: '2026-08-20T15:00:00Z',
      nextRequiredAction: 'Call client',
      risk: {
        atRisk: true,
        reasons: [],
        lastEvaluatedAt: '2026-08-10T15:00:00Z',
        requiredNextAction: 'Call client',
      },
    });
  });

  it('fails closed when client identity and canonical tenant do not match', () => {
    expect(() => composeFilterSortAndPageClients(
      [canonical('1', { tenant_id: 'different-tenant' })],
      [client('1')],
      {},
    )).toThrow(/tenant_id mismatch/);
  });

  it('fails closed if a Lead row reaches the formal client directory', () => {
    expect(() => composeFilterSortAndPageClients(
      [canonical('1', { lifecycle: 'Lead' })],
      [client('1')],
      {},
    )).toThrow(/Lead is not a client lifecycle stage/);
  });
});

describe('canonical client read filters', () => {
  it('serializes CRM domain filters to the canonical view contract, not storage enums', () => {
    expect(mapDomainLifecycleToCanonicalRead('Registration')).toBe('Registration');
    expect(mapDomainEngagementToCanonicalRead('Engaged')).toBe('Normal');
    expect(mapDomainEngagementToCanonicalRead('Warm')).toBe('Unresponsive Warm');
    expect(mapDomainEligibilityToCanonicalRead('Coverage Issue')).toBe('Coverage Issue');
    expect(mapDomainContactPolicyToCanonicalRead('Contact Allowed')).toBe('Normal');
    expect(mapDomainServicePolicyToCanonicalRead('Service Allowed')).toBe('Normal');
  });
});
