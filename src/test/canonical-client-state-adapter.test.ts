import { describe, expect, it } from 'vitest';
import type { Database } from '@/integrations/supabase/types';
import { CONTRACT_VERSION } from '@/lib/crm/contracts';
import {
  classifyError,
  resolveCanonicalRead,
  toCanonicalClientState,
} from '@/lib/crm/canonicalClientStateAdapter';

type CanonicalRow = Database['public']['Views']['v_client_canonical_state']['Row'];

function row(overrides: Partial<CanonicalRow> = {}): CanonicalRow {
  return {
    client_id: 'client-1',
    tenant_id: 'tenant-1',
    contract_version: CONTRACT_VERSION,
    lifecycle: 'Scheduled',
    engagement: 'Normal',
    at_risk: {
      at_risk: false,
      evaluated_at: '2026-07-15T00:00:00.000Z',
      recommended_next_action: null,
      event_version: 'event-1',
      reason: null,
    },
    eligibility: 'Eligible',
    eligibility_manual_review: null,
    contact_policy: 'Normal',
    service_policy: 'Normal',
    care_cadence: 'regular',
    disposition_reason: null,
    disposition_at: null,
    assigned_therapist_id: null,
    next_appointment_at: null,
    provider_demand_state: 'none',
    concurrency_token: 'token-1',
    updated_at: '2026-07-15T00:00:00.000Z',
    ...overrides,
  };
}

describe('canonical client-state adapter', () => {
  it('accepts the deployed canonical view representation without reinterpreting storage enums', () => {
    expect(toCanonicalClientState(row())).toMatchObject({
      lifecycle: 'Scheduled',
      engagement: 'Normal',
      eligibility: 'Eligible',
      contact_policy: 'Normal',
      service_policy: 'Normal',
      care_cadence: 'regular',
      disposition_reason: null,
    });
  });

  it.each([
    ['lifecycle', 'Early Care'],
    ['engagement', 'Unresponsive Warm'],
    ['eligibility', 'Coverage Issue'],
    ['contact_policy', 'Do Not Contact'],
    ['service_policy', 'Service Blocked'],
    ['disposition_reason', 'Completed Care'],
  ] as const)('accepts deployed %s value %s', (field, value) => {
    const result = toCanonicalClientState(row({ [field]: value }));
    expect(result[field]).toBe(value);
  });

  it('accepts complete at-risk and manual-review payloads and ignores extra view metadata', () => {
    const result = toCanonicalClientState(row({
      at_risk: {
        at_risk: true,
        evaluated_at: '2026-07-15T00:00:00.000Z',
        recommended_next_action: 'Call client',
        event_version: 'v1',
        reason: 'follow_up_gap',
      },
      eligibility: 'Manual Review',
      eligibility_manual_review: {
        reason: 'Coverage unclear',
        owner: 'ops-1',
        next_action: 'Verify plan',
        review_due_at: '2026-07-20T00:00:00.000Z',
      },
    }));
    expect(result.at_risk).toEqual({
      at_risk: true,
      evaluated_at: '2026-07-15T00:00:00.000Z',
      recommended_next_action: 'Call client',
      event_version: 'v1',
    });
    expect(result.eligibility_manual_review?.owner).toBe('ops-1');
  });

  it('fails closed when the canonical contract version does not match the CRM', () => {
    expect(() => toCanonicalClientState(row({ contract_version: 'valorwell-crm-contracts@2' })))
      .toThrow(/contract version mismatch/i);
  });

  it.each([
    ['raw lifecycle storage enum', { lifecycle: 'scheduled' }],
    ['raw engagement storage enum', { engagement: 'normal' }],
    ['raw contact-policy storage enum', { contact_policy: 'do_not_contact' }],
    ['unknown lifecycle', { lifecycle: 'not_a_lifecycle' }],
    ['invalid at-risk JSON', { at_risk: { at_risk: 'false' } }],
    ['invalid manual-review JSON', { eligibility_manual_review: { owner: 'ops-1' } }],
  ])('fails closed for %s', (_label, overrides) => {
    expect(() => toCanonicalClientState(row(overrides as Partial<CanonicalRow>))).toThrow();
  });

  it('classifies only missing-contract errors', () => {
    expect(classifyError("relation 'public.v_client_canonical_state' does not exist")).toBe('CONTRACT_NOT_DEPLOYED');
    expect(classifyError("Could not find the table 'public.v_client_canonical_state' in the schema cache")).toBe('CONTRACT_NOT_DEPLOYED');
    expect(classifyError('permission denied for relation v_client_canonical_state')).toBeNull();
    expect(classifyError('Failed to fetch')).toBeNull();
  });

  it('returns ok and empty results, and throws unrelated read errors', () => {
    expect(resolveCanonicalRead(row(), null).status).toBe('ok');
    expect(resolveCanonicalRead(null, null)).toEqual({ status: 'empty', data: null });
    expect(() => resolveCanonicalRead(null, { message: 'permission denied' })).toThrow('permission denied');
  });
});
