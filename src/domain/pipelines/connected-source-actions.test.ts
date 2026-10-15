import { describe, expect, it } from 'vitest';
import { connectedSourceAction } from './connected-source-actions';

describe('connected source action capabilities', () => {
  it('never supplies a generic mutation for staff, clients, prospects or unknown sources', () => {
    for (const source of ['staff', 'clients', 'therapist_prospects', 'unknown', null]) {
      expect(connectedSourceAction(source, 'new')).toBeNull();
    }
  });
  it('retains applicant first-contact, approval and invitation holds', () => {
    expect(connectedSourceAction('provider_applicants', 'contacted')?.destinations).toEqual(['screening']);
    for (const status of ['new', 'screening', 'ready', 'hired']) {
      expect(connectedSourceAction('provider_applicants', status)?.destinations).toEqual([]);
    }
  });
  it('retains the independent BTY workflow and campaign-readiness exclusion', () => {
    expect(connectedSourceAction('relationship_opportunities', 'responded')?.destinations).toContain('interested');
    expect(connectedSourceAction('relationship_opportunities', 'qualified')?.destinations).not.toContain('ready_for_campaign');
  });
});
