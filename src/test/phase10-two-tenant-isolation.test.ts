import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tenantBoundary, type BoundaryRow } from '@/test/helpers/tenantSupabaseBoundary';

vi.mock('@/integrations/supabase/client', async () => {
  const { tenantBoundary: boundary } = await import('@/test/helpers/tenantSupabaseBoundary');
  return { supabase: boundary.supabase };
});

import { supabaseTasksRepository } from '@/repositories/supabase/tasks';
import { supabaseExceptionsRepository } from '@/repositories/supabase/exceptions';
import { supabaseStaffRepository } from '@/repositories/supabase/staff';
import { supabaseCampaignsRepository } from '@/repositories/supabase/campaigns';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const NOW = '2026-10-07T12:00:00.000Z';

function taskRow(
  id: string,
  tenantId: string,
  overrides: BoundaryRow = {},
): BoundaryRow {
  return {
    id,
    tenant_id: tenantId,
    title: id,
    description: null,
    client_id: null,
    staff_id: null,
    campaign_id: null,
    exception_id: null,
    type: 'general',
    priority: 'normal',
    status: 'not_started',
    owner_id: null,
    collaborator_ids: [],
    created_by_profile_id: 'profile-operator',
    start_at: null,
    due_at: '2026-10-08T12:00:00.000Z',
    completed_at: null,
    recurrence: null,
    checklist: [],
    tags: [],
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function exceptionRow(
  id: string,
  tenantId: string,
  ownerId: string,
): BoundaryRow {
  return {
    id,
    tenant_id: tenantId,
    type: 'manual_review_required',
    severity: 'high',
    status: 'open',
    client_id: null,
    campaign_id: null,
    workflow: 'phase10',
    owner_id: ownerId,
    due_at: null,
    last_activity_at: NOW,
    summary: 'Exception ' + id,
    recommended_resolution: 'Review ' + id,
    resolution_history: [],
    created_at: NOW,
    updated_at: NOW,
  };
}

function staffRow(
  id: string,
  tenantId: string,
  profileId: string,
  firstName: string,
): BoundaryRow {
  return {
    id,
    tenant_id: tenantId,
    profile_id: profileId,
    prov_name_f: firstName,
    prov_name_m: null,
    prov_name_l: 'Operator',
    prov_name_for_clients: firstName + ' Operator',
    prov_phone: null,
    prov_state: 'MO',
    prov_status: 'Active',
    prov_accepting_new_clients: true,
    prov_max_clients: 10,
  };
}

function campaignRow(id: string, tenantId: string, name: string): BoundaryRow {
  return {
    id,
    tenant_id: tenantId,
    name,
    description: name + ' description',
    is_active: true,
    on_complete_action: 'none',
    on_complete_status: null,
    on_complete_engagement_state: null,
    on_complete_lifecycle_stage: null,
    default_timezone: 'America/Chicago',
    send_window_start: null,
    send_window_end: null,
    weekdays_only: false,
    created_by_profile_id: 'profile-operator',
    created_at: NOW,
    updated_at: NOW,
  };
}

function stepRow(
  id: string,
  tenantId: string,
  campaignId: string,
  subject: string,
): BoundaryRow {
  return {
    id,
    campaign_id: campaignId,
    tenant_id: tenantId,
    step_order: 1,
    channel: 'email',
    is_active: true,
    delay_days: 0,
    delay_hours: 1,
    email_subject: subject,
    email_body_html: '<p>' + subject + '</p>',
    sms_body_text: null,
    signature_id: null,
    created_at: NOW,
    updated_at: NOW,
  };
}

function enrollmentRow(
  id: string,
  tenantId: string,
  campaignId: string,
  clientId: string,
  status = 'active',
): BoundaryRow {
  return {
    id,
    campaign_id: campaignId,
    client_id: clientId,
    tenant_id: tenantId,
    status,
    current_step: 1,
    pause_reason: null,
    enrolled_at: NOW,
    completed_at: null,
    enrolled_by_profile_id: 'profile-operator',
    created_at: NOW,
    updated_at: NOW,
  };
}

function seedBoundary() {
  tenantBoundary.reset({
    crm_tasks: [
      taskRow('task-a', TENANT_A),
      taskRow('task-b', TENANT_B),
      taskRow('task-a-staff', TENANT_A, { staff_id: 'staff-a' }),
      taskRow('task-b-cross-staff', TENANT_B, { staff_id: 'staff-a' }),
    ],
    crm_exceptions: [
      exceptionRow('exception-a', TENANT_A, 'profile-owner-a'),
      exceptionRow('exception-b', TENANT_B, 'profile-owner-b'),
    ],
    staff: [
      staffRow('staff-a', TENANT_A, 'profile-a', 'Alice'),
      staffRow('staff-b', TENANT_B, 'profile-b', 'Bob'),
    ],
    profiles: [
      { id: 'profile-a', email: 'alice@example.test' },
      { id: 'profile-b', email: 'bob@example.test' },
    ],
    user_roles: [
      { user_id: 'profile-a', role: 'admin' },
      { user_id: 'profile-b', role: 'clinician' },
    ],
    clients: [
      { id: 'client-a', tenant_id: TENANT_A, primary_staff_id: 'staff-a' },
      { id: 'client-b', tenant_id: TENANT_B, primary_staff_id: 'staff-a' },
    ],
    crm_campaigns: [
      campaignRow('campaign-a', TENANT_A, 'Campaign A'),
      campaignRow('campaign-b', TENANT_B, 'Campaign B'),
    ],
    crm_campaign_steps: [
      stepRow('step-a', TENANT_A, 'campaign-a', 'A subject'),
      stepRow('step-b-cross', TENANT_B, 'campaign-a', 'B contamination subject'),
      stepRow('step-b', TENANT_B, 'campaign-b', 'B subject'),
    ],
    crm_campaign_triggers: [
      {
        id: 'trigger-a',
        tenant_id: TENANT_A,
        campaign_id: 'campaign-a',
        trigger_on_status: 'A_STATUS',
        is_active: true,
      },
      {
        id: 'trigger-b-cross',
        tenant_id: TENANT_B,
        campaign_id: 'campaign-a',
        trigger_on_status: 'B_CONTAMINATION',
        is_active: true,
      },
      {
        id: 'trigger-b',
        tenant_id: TENANT_B,
        campaign_id: 'campaign-b',
        trigger_on_status: 'B_STATUS',
        is_active: true,
      },
    ],
    crm_campaign_enrollments: [
      enrollmentRow('enrollment-a', TENANT_A, 'campaign-a', 'client-a', 'active'),
      enrollmentRow('enrollment-b-cross', TENANT_B, 'campaign-a', 'client-b', 'completed'),
      enrollmentRow('enrollment-b', TENANT_B, 'campaign-b', 'client-b', 'active'),
    ],
  });
}

describe('Phase 10 executable two-tenant repository isolation', () => {
  beforeEach(() => {
    seedBoundary();
  });

  it('keeps task reads and mixed-ID mutations inside the selected tenant', async () => {
    await expect(supabaseTasksRepository.get(TENANT_A, 'task-b')).resolves.toBeNull();

    await supabaseTasksRepository.bulkStatus(
      TENANT_A,
      ['task-a', 'task-b'],
      'Completed',
    );

    expect(tenantBoundary.rows('crm_tasks').find((row) => row.id === 'task-a')?.status)
      .toBe('completed');
    expect(tenantBoundary.rows('crm_tasks').find((row) => row.id === 'task-b')?.status)
      .toBe('not_started');
  });

  describe('exceptions', () => {
    it('switches result sets by operating tenant and fails closed on cross-tenant reads', async () => {
      const a = await supabaseExceptionsRepository.list(TENANT_A);
      const b = await supabaseExceptionsRepository.list(TENANT_B);

      expect(a.map((row) => row.id)).toEqual(['exception-a']);
      expect(b.map((row) => row.id)).toEqual(['exception-b']);
      await expect(
        supabaseExceptionsRepository.get(TENANT_A, 'exception-b'),
      ).resolves.toBeNull();
    });

    it('cannot resolve, dismiss, or reassign a foreign exception', async () => {
      const before = structuredClone(
        tenantBoundary.rows('crm_exceptions').find((row) => row.id === 'exception-b'),
      );

      await expect(
        supabaseExceptionsRepository.resolve(TENANT_A, 'exception-b', 'foreign'),
      ).rejects.toThrow('Exception not found');
      await expect(
        supabaseExceptionsRepository.dismiss(TENANT_A, 'exception-b', 'foreign'),
      ).rejects.toThrow('Exception not found');
      await expect(
        supabaseExceptionsRepository.reassign(TENANT_A, 'exception-b', 'profile-attacker'),
      ).rejects.toThrow('Expected one row');

      expect(
        tenantBoundary.rows('crm_exceptions').find((row) => row.id === 'exception-b'),
      ).toEqual(before);
    });

    it('blocks task creation from a foreign exception and creates an A task with profile-owner semantics', async () => {
      const initialTaskCount = tenantBoundary.rows('crm_tasks').length;

      await expect(
        supabaseExceptionsRepository.createTaskFromException(TENANT_A, 'exception-b'),
      ).rejects.toThrow('Exception not found');
      expect(tenantBoundary.rows('crm_tasks')).toHaveLength(initialTaskCount);

      const created = await supabaseExceptionsRepository.createTaskFromException(
        TENANT_A,
        'exception-a',
      );

      expect(created).toMatchObject({
        tenantId: TENANT_A,
        exceptionId: 'exception-a',
        ownerId: 'profile-owner-a',
        createdByProfileId: 'profile-operator',
        type: 'Campaign Exception',
      });
      expect(
        tenantBoundary.rows('crm_tasks').find((row) => row.id === created.id),
      ).toMatchObject({
        tenant_id: TENANT_A,
        exception_id: 'exception-a',
        owner_id: 'profile-owner-a',
        created_by_profile_id: 'profile-operator',
      });
    });
  });

  describe('staff', () => {
    it('switches the staff directory by operating tenant and rejects a foreign staff ID', async () => {
      const a = await supabaseStaffRepository.list(TENANT_A);
      const b = await supabaseStaffRepository.list(TENANT_B);

      expect(a.map((row) => row.id)).toEqual(['staff-a']);
      expect(b.map((row) => row.id)).toEqual(['staff-b']);
      await expect(supabaseStaffRepository.get(TENANT_A, 'staff-b')).resolves.toBeNull();
    });

    it('does not mix tenant-B client or task aggregation into an A staff object', async () => {
      const staff = await supabaseStaffRepository.get(TENANT_A, 'staff-a');

      expect(staff).toMatchObject({
        id: 'staff-a',
        tenantId: TENANT_A,
        caseloadCount: 1,
        openTaskCount: 1,
      });
    });
  });

  describe('campaigns', () => {
    it('isolates list/get and intentionally switches result sets with the selected tenant', async () => {
      const a = await supabaseCampaignsRepository.list(TENANT_A);
      const b = await supabaseCampaignsRepository.list(TENANT_B);

      expect(a.map((row) => row.id)).toEqual(['campaign-a']);
      expect(b.map((row) => row.id)).toEqual(['campaign-b']);
      await expect(
        supabaseCampaignsRepository.get(TENANT_A, 'campaign-b'),
      ).resolves.toBeNull();
    });

    it('keeps steps, triggers, metrics, and enrollments scoped to the selected tenant', async () => {
      const campaign = await supabaseCampaignsRepository.get(TENANT_A, 'campaign-a');
      const enrollments = await supabaseCampaignsRepository.enrollments(
        TENANT_A,
        'campaign-a',
      );

      expect(campaign?.steps.map((step) => step.id)).toEqual(['step-a']);
      expect(campaign?.entryConditions).toEqual(['Status: A_STATUS']);
      expect(campaign?.metrics).toMatchObject({
        enrolled: 1,
        active: 1,
        completed: 0,
        failed: 0,
      });
      expect(enrollments.map((row) => row.id)).toEqual(['enrollment-a']);
    });

    it('fails closed when updating a foreign campaign without modifying tenant B', async () => {
      const before = structuredClone(
        tenantBoundary.rows('crm_campaigns').find((row) => row.id === 'campaign-b'),
      );

      await expect(
        supabaseCampaignsRepository.update(
          TENANT_A,
          'campaign-b',
          { name: 'Cross-tenant mutation' },
        ),
      ).rejects.toThrow('Expected one row');

      expect(
        tenantBoundary.rows('crm_campaigns').find((row) => row.id === 'campaign-b'),
      ).toEqual(before);
    });

    it('rejects enrolling a tenant-B client into an A campaign before any RPC runs', async () => {
      await expect(
        supabaseCampaignsRepository.enroll(
          TENANT_A,
          'campaign-a',
          ['client-b'],
        ),
      ).rejects.toThrow('One or more clients do not belong to the current operating tenant');

      expect(tenantBoundary.rpcCalls).toHaveLength(0);
      expect(
        tenantBoundary.rows('crm_campaign_enrollments').filter(
          (row) => row.tenant_id === TENANT_B,
        ),
      ).toHaveLength(2);
    });

    it('cannot mutate a tenant-B enrollment while tenant A is selected', async () => {
      const before = structuredClone(
        tenantBoundary.rows('crm_campaign_enrollments').find(
          (row) => row.id === 'enrollment-b',
        ),
      );

      await expect(
        supabaseCampaignsRepository.pauseEnrollment(
          TENANT_A,
          'enrollment-b',
          'Phase 10 isolation check',
        ),
      ).rejects.toThrow('Enrollment not found in current operating tenant');

      expect(tenantBoundary.rpcCalls).toHaveLength(0);
      expect(
        tenantBoundary.rows('crm_campaign_enrollments').find(
          (row) => row.id === 'enrollment-b',
        ),
      ).toEqual(before);
    });
  });
});
