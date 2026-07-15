import { describe, expect, it } from 'vitest';
import type { Database } from '@/integrations/supabase/types';
import {
  classifyError,
  resolveCanonicalRead,
  toCanonicalClientState,
} from '@/hooks/crm/useCanonicalClientState';

type CanonicalRow = Database['public']['Views']['v_client_canonical_state']['Row'];

function row(overrides: Partial<CanonicalRow> = {}): CanonicalRow {
  return {
    client_id: 'client-1',
    tenant_id: 'tenant-1',
    contract_version: 'valorwell-crm-contracts@1.0.1+20260714',
    lifecycle: 'scheduled',
    engagement: 'normal',
    at_risk: { at_risk: false },
    eligibility: 'eligible',
    eligibility_manual_review: null,
    contact_policy: 'normal',
    service_policy: 'normal',
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
  it('converts raw database values into the contract display values', () => {
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
    ['early_care', 'Early Care'],
    ['unresponsive_warm', 'Unresponsive Warm'],
    ['coverage_issue', 'Coverage Issue'],
    ['do_not_contact', 'Do Not Contact'],
    ['service_blocked', 'Service Blocked'],
    ['completed_care', 'Completed Care'],
  ])('maps %s to %s', (raw, expected) => {
    const field = raw === 'early_care' ? 'lifecycle'
      : raw === 'unresponsive_warm' ? 'engagement'
        : raw === 'coverage_issue' ? 'eligibility'
          : raw === 'do_not_contact' ? 'contact_policy'
            : raw === 'service_blocked' ? 'service_policy' : 'disposition_reason';
    const result = toCanonicalClientState(row({ [field]: raw }));
    expect(result[field as keyof typeof result]).toBe(expected);
  });

  it('accepts the minimal deployed at-risk payload', () => {
    expect(toCanonicalClientState(row()).at_risk).toEqual({ at_risk: false });
  });

  it('accepts complete at-risk and manual-review payloads', () => {
    const result = toCanonicalClientState(row({
      at_risk: {
        at_risk: true,
        evaluated_at: '2026-07-15T00:00:00.000Z',
        recommended_next_action: 'Call client',
        event_version: 'v1',
      },
      eligibility: 'manual_review',
      eligibility_manual_review: {
        reason: 'Coverage unclear', owner: 'ops-1', next_action: 'Verify plan', review_due_at: '2026-07-20T00:00:00.000Z',
      },
    }));
    expect(result.at_risk.at_risk).toBe(true);
    expect(result.eligibility_manual_review?.owner).toBe('ops-1');
  });

  it.each([
    ['unknown lifecycle', { lifecycle: 'not_a_lifecycle' }],
    ['invalid at-risk JSON', { at_risk: { at_risk: 'false' } }],
    ['invalid manual-review JSON', { eligibility_manual_review: { owner: 'ops-1' } }],
  ])('fails closed for %s', (_label, overrides) => {
    expect(() => toCanonicalClientState(row(overrides))).toThrow(/invalid/);
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
