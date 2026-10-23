import { describe, expect, it } from 'vitest';
import { connectedSourceAction } from './connected-source-actions';

describe('connected source action capabilities', () => {
  it('never supplies a generic mutation for staff, clients, prospects or unknown sources', () => {
    for (const source of ['staff', 'clients', 'therapist_prospects', 'unknown', null])
      expect(connectedSourceAction(source, 'new')).toBeNull();
  });
  it('supports only scoped applicant transitions', () => {
    expect(connectedSourceAction('provider_applicants', 'contacted')?.destinations).toEqual(['screening']);
    expect(connectedSourceAction('provider_applicants', 'contacted')?.requiresFollowup).toBe(true);
    expect(connectedSourceAction('provider_applicants', 'screening')?.destinations).toEqual(['interview_invited']);
    expect(connectedSourceAction('provider_applicants', 'interview_scheduled')?.destinations).toEqual(['interview_completed','accepted']);
    expect(connectedSourceAction('provider_applicants', 'interview_completed')?.destinations).toEqual(['accepted']);
    expect(connectedSourceAction('provider_applicants', 'interview_scheduled')?.requiresFollowup).toBe(false);
    for (const status of ['new', 'application', 'ready', 'hired'])
      expect(connectedSourceAction('provider_applicants', status)?.destinations).toEqual([]);
  });
  it('keeps separate BTY workflow', () => {
    expect(connectedSourceAction('relationship_opportunities', 'responded')?.destinations).toContain('interested');
    expect(connectedSourceAction('relationship_opportunities', 'qualified')?.destinations).not.toContain('ready_for_campaign');
  });
});