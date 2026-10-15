import { describe, expect, it } from 'vitest';
import { applicantHandoffMessage } from './applicant-handoff';

describe('staff handoff evidence', () => {
  it('does not report an approved applicant as invited without source linkage', () => {
    expect(applicantHandoffMessage('ready', { ownerName: null, convertedStaffId: null }))
      .toContain('no linked staff record');
  });
  it('does not interpret staff linkage as delivery or completed onboarding', () => {
    expect(applicantHandoffMessage('ready', { ownerName: 'Recruiter', convertedStaffId: 'staff-id' }))
      .toBe('A staff record is linked. Confirm invitation and onboarding progress in the staff workspace.');
  });
  it('surfaces inconsistent onboarding evidence for manual reconciliation', () => {
    expect(applicantHandoffMessage('hired', { ownerName: null, convertedStaffId: null }))
      .toContain('Reconcile the source record');
  });
});
