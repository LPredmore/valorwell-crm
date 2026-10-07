import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildStaffOperatorDisplayName,
  findStaffByProfileId,
  resolveStaffOperatorLabel,
} from '@/domain/staffIdentity';
import type { StaffMember } from '@/domain/operations';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

function staff(overrides: Partial<StaffMember> = {}): StaffMember {
  return {
    id: 'staff-record-1',
    profileId: 'profile-1',
    tenantId: 'tenant-a',
    firstName: 'Morgan',
    lastName: 'Lee',
    displayName: 'Morgan Lee',
    role: 'clinician',
    status: 'Active',
    states: ['MO'],
    email: 'morgan@example.org',
    caseloadCount: 0,
    openTaskCount: 0,
    availability: 'Available',
    ...overrides,
  };
}

describe('Phase 3 staff identity and ownership contract', () => {
  it('builds operator display names in the canonical fallback order', () => {
    expect(buildStaffOperatorDisplayName({
      preferredDisplayName: ' Dr. Morgan ',
      firstName: 'Morgan',
      lastName: 'Lee',
      email: 'morgan@example.org',
    })).toBe('Dr. Morgan');

    expect(buildStaffOperatorDisplayName({
      preferredDisplayName: ' ',
      firstName: 'Morgan',
      lastName: 'Lee',
      email: 'morgan@example.org',
    })).toBe('Morgan Lee');

    expect(buildStaffOperatorDisplayName({
      email: 'morgan@example.org',
    })).toBe('morgan@example.org');

    expect(buildStaffOperatorDisplayName({})).toBe('Unknown staff member');
  });

  it('resolves operational ownership by profileId rather than staff.id', () => {
    const members = [staff()];
    expect(findStaffByProfileId(members, 'profile-1')?.id).toBe('staff-record-1');
    expect(findStaffByProfileId(members, 'staff-record-1')).toBeUndefined();
    expect(resolveStaffOperatorLabel(members, 'profile-1')).toBe('Morgan Lee');
    expect(resolveStaffOperatorLabel(members, 'unknown-profile')).toBe('Unknown staff member');
    expect(resolveStaffOperatorLabel(members, null)).toBe('Unassigned');
  });

  it('wires exception assignment to profileId and task display to the resolver', () => {
    const exceptions = read('src/pages/crm/canonical/CanonicalExceptions.tsx');
    const tasks = read('src/pages/crm/canonical/CanonicalTasks.tsx');

    expect(exceptions).toContain('value={s.profileId as string}');
    expect(exceptions).not.toContain('value={s.id}>{s.displayName}');
    expect(tasks).toContain('resolveStaffOperatorLabel(staff, t.ownerId)');
    expect(tasks).not.toContain("{t.ownerId ?? 'Unassigned'}");
  });

  it('exposes profileId separately from the staff record ID', () => {
    const source = read('src/repositories/supabase/staff.ts');
    expect(source).toContain('profileId: r.profile_id ?? undefined');
    expect(source).toContain('id: r.id');
  });

  it('resolves report task assignees through staff.profile_id, not staff.id', () => {
    const reports = read('src/repositories/supabase/reports.ts');
    expect(reports).toContain(".in('profile_id', assigneeIds)");
    expect(reports).not.toContain(".in('id', assigneeIds)");
    expect(reports).toContain("campaignName:");
    expect(reports).toContain("assigneeName:");
  });
});
