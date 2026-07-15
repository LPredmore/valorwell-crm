import { describe, expect, it } from 'vitest';
import { composeFilterSortAndPageClients } from '@/repositories/supabase/clients';
import type { Database } from '@/integrations/supabase/types';

type CanonicalRow = Database['public']['Views']['v_client_canonical_state']['Row'];

function canonical(id: string, overrides: Partial<CanonicalRow> = {}): CanonicalRow {
  return {
    client_id: id,
    tenant_id: 't1',
    lifecycle: 'scheduled',
    engagement: 'normal',
    eligibility: 'eligible',
    contact_policy: 'normal',
    service_policy: 'normal',
    care_cadence: 'regular',
    assigned_therapist_id: null,
    at_risk: { at_risk: false },
    concurrency_token: `tok-${id}`,
    contract_version: 'valorwell-crm-contracts@1.0.1+20260714',
    disposition_at: null,
    disposition_reason: null,
    eligibility_manual_review: null,
    next_appointment_at: null,
    provider_demand_state: null,
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
    const canonicalRows = [canonical('1', { lifecycle: 'scheduled' }), canonical('2', { lifecycle: 'scheduled' })];
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

  it('canonical state overrides conflicting raw clients state', () => {
    const result = composeFilterSortAndPageClients(
      [canonical('1', { lifecycle: 'scheduled', engagement: 'normal' })],
      [client('1', { lifecycle_stage: 'closed', engagement_state: 'cold' })],
      {},
    );
    expect(result.rows[0].lifecycle).toBe('Scheduled');
    expect(result.rows[0].engagement).toBe('Engaged');
  });
});
