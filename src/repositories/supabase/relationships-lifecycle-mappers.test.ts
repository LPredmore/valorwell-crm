import { describe, expect, it } from 'vitest';
import type { CreateInteractionInput } from '@/domain/relationships/contracts';
import {
  assertInteractionSubject,
  assertStageSubject,
  buildInteractionInsert,
  mapInteractionRow,
  mapStageHistoryRow,
  type LifecycleInteractionRow,
  type LifecycleStageHistoryRow,
} from './relationships-lifecycle-mappers';

const historyRow: LifecycleStageHistoryRow = {
  id: 'history-1',
  tenant_id: 'tenant-1',
  organization_id: null,
  contact_id: 'contact-1',
  from_stage: 'identified',
  to_stage: 'qualified_outreach',
  changed_at: '2026-07-21T12:00:00.000Z',
  reason: 'Qualified for outreach',
  metadata: {},
  created_by_profile_id: 'profile-1',
  updated_by_profile_id: 'profile-1',
  created_at: '2026-07-21T12:00:01.000Z',
  updated_at: '2026-07-21T12:00:01.000Z',
};

const interactionRow: LifecycleInteractionRow = {
  id: 'interaction-1',
  tenant_id: 'tenant-1',
  organization_id: 'organization-1',
  contact_id: 'contact-1',
  opportunity_id: null,
  interaction_type: 'manual_note',
  occurred_at: '2026-07-21T13:00:00.000Z',
  summary: 'Confirmed contact details.',
  metadata: {},
  created_by_profile_id: 'profile-1',
  updated_by_profile_id: 'profile-1',
  created_at: '2026-07-21T13:00:01.000Z',
  updated_at: '2026-07-21T13:00:01.000Z',
};

describe('relationship lifecycle persistence mappers', () => {
  it('accepts exactly one organization or contact for a stage transition', () => {
    expect(assertStageSubject({ organizationId: ' organization-1 ' })).toEqual({
      organizationId: 'organization-1',
      contactId: null,
    });
    expect(assertStageSubject({ contactId: 'contact-1' })).toEqual({
      organizationId: null,
      contactId: 'contact-1',
    });
    expect(() => assertStageSubject({})).toThrow(/Exactly one/);
    expect(() => assertStageSubject({ organizationId: 'o', contactId: 'c' })).toThrow(/Exactly one/);
    expect(() => assertStageSubject({ opportunityId: 'opportunity-1' })).toThrow(/Exactly one/);
  });

  it('requires at least one subject for interaction queries', () => {
    expect(assertInteractionSubject({ contactId: ' contact-1 ' })).toEqual({
      organizationId: undefined,
      contactId: 'contact-1',
      opportunityId: undefined,
    });
    expect(() => assertInteractionSubject({})).toThrow(/required/);
  });

  it('builds a tenant-scoped interaction insert with actor attribution', () => {
    const input: CreateInteractionInput = {
      organizationId: 'organization-1',
      contactId: 'contact-1',
      type: 'manual_note',
      occurredAt: '2026-07-21T13:00:00.000Z',
      summary: '  Confirmed contact details.  ',
    };

    expect(buildInteractionInsert('tenant-1', 'profile-1', input)).toEqual({
      tenant_id: 'tenant-1',
      organization_id: 'organization-1',
      contact_id: 'contact-1',
      opportunity_id: null,
      interaction_type: 'manual_note',
      occurred_at: '2026-07-21T13:00:00.000Z',
      summary: 'Confirmed contact details.',
      created_by_profile_id: 'profile-1',
      updated_by_profile_id: 'profile-1',
    });
  });

  it('rejects blank summaries and opportunity-only interaction inserts', () => {
    expect(() => buildInteractionInsert('tenant-1', 'profile-1', {
      contactId: 'contact-1',
      type: 'manual_note',
      occurredAt: '2026-07-21T13:00:00.000Z',
      summary: '   ',
    })).toThrow(/summary/);

    expect(() => buildInteractionInsert('tenant-1', 'profile-1', {
      opportunityId: 'opportunity-1',
      type: 'manual_note',
      occurredAt: '2026-07-21T13:00:00.000Z',
      summary: 'Opportunity note',
    })).toThrow(/organization or contact/);
  });

  it('maps lifecycle rows into stable application contracts', () => {
    expect(mapStageHistoryRow(historyRow)).toEqual({
      id: 'history-1',
      contactId: 'contact-1',
      from: 'identified',
      to: 'qualified_outreach',
      changedAt: '2026-07-21T12:00:00.000Z',
      reason: 'Qualified for outreach',
      createdAt: '2026-07-21T12:00:01.000Z',
      updatedAt: '2026-07-21T12:00:01.000Z',
      createdBy: 'profile-1',
      updatedBy: 'profile-1',
    });

    expect(mapInteractionRow(interactionRow)).toEqual({
      id: 'interaction-1',
      organizationId: 'organization-1',
      contactId: 'contact-1',
      type: 'manual_note',
      actorId: 'profile-1',
      occurredAt: '2026-07-21T13:00:00.000Z',
      summary: 'Confirmed contact details.',
      createdAt: '2026-07-21T13:00:01.000Z',
      updatedAt: '2026-07-21T13:00:01.000Z',
      createdBy: 'profile-1',
      updatedBy: 'profile-1',
    });
  });
});
