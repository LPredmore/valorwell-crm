import { describe, expect, it } from 'vitest';
import {
  buildOpportunityInsert,
  buildOpportunityUpdate,
  mapOpportunityRow,
  type RelationshipOpportunityRow,
} from './relationships-opportunity-mappers';

const row: RelationshipOpportunityRow = {
  id: 'opportunity-1',
  tenant_id: 'tenant-1',
  organization_id: 'organization-1',
  primary_contact_id: 'contact-1',
  status: 'qualified',
  owner_profile_id: 'profile-1',
  cause_area: 'veteran mental health',
  veteran_priority: true,
  qualification: { mission_fit: true, audience_reach: 4 },
  review_status: 'approved',
  risk_flags: ['message_alignment'],
  next_action: 'Prepare outreach',
  next_action_due_at: '2026-07-23T15:00:00.000Z',
  status_changed_at: '2026-07-21T20:00:00.000Z',
  closed_at: null,
  version: 3,
  metadata: {},
  created_by_profile_id: 'profile-1',
  updated_by_profile_id: 'profile-1',
  created_at: '2026-07-21T19:00:00.000Z',
  updated_at: '2026-07-21T20:00:00.000Z',
};

describe('relationship opportunity persistence mappers', () => {
  it('maps database rows into the stable opportunity contract', () => {
    expect(mapOpportunityRow(row)).toMatchObject({
      id: 'opportunity-1',
      organizationId: 'organization-1',
      primaryContactId: 'contact-1',
      status: 'qualified',
      ownerId: 'profile-1',
      causeArea: 'veteran mental health',
      veteranPriority: true,
      qualification: { mission_fit: true, audience_reach: 4 },
      createdBy: 'profile-1',
    });
  });

  it('builds tenant-scoped inserts with actor attribution', () => {
    expect(buildOpportunityInsert('tenant-1', 'profile-1', {
      organizationId: 'organization-1',
      primaryContactId: ' contact-1 ',
      status: 'identified',
      causeArea: ' veteran mental health ',
      veteranPriority: true,
      qualification: { mission_fit: true },
      nextAction: ' Research fit ',
    })).toEqual({
      tenant_id: 'tenant-1',
      organization_id: 'organization-1',
      primary_contact_id: 'contact-1',
      status: 'identified',
      owner_profile_id: null,
      cause_area: 'veteran mental health',
      veteran_priority: true,
      qualification: { mission_fit: true },
      next_action: 'Research fit',
      next_action_due_at: null,
      created_by_profile_id: 'profile-1',
      updated_by_profile_id: 'profile-1',
    });
  });

  it('maps editable fields and clears optional values explicitly', () => {
    expect(buildOpportunityUpdate('profile-1', {
      primaryContactId: undefined,
      causeArea: undefined,
      veteranPriority: false,
      qualification: { audience_reach: 5 },
      nextAction: undefined,
      nextActionDueAt: undefined,
    })).toEqual({
      primary_contact_id: null,
      cause_area: null,
      veteran_priority: false,
      qualification: { audience_reach: 5 },
      next_action: null,
      next_action_due_at: null,
      updated_by_profile_id: 'profile-1',
    });
  });

  it('requires status changes to use the transition workflow', () => {
    expect(() => buildOpportunityUpdate('profile-1', { status: 'qualified' }))
      .toThrow(/status transition workflow/);
  });
});
