// Prepared only; execution deferred to Todoist task 42.
import { describe, expect, it } from 'vitest';
import { applicantWorkspaceLink } from './applicant-workspace-link';
describe('staff applicant locator', () => {
  it('encodes names and an exact reference while fixing the destination origin and route', () => {
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const url = new URL(applicantWorkspaceLink(id, 'Example & Other?next=https://foreign.test'));
    expect(url.origin).toBe('https://emr.valorwell.org');
    expect(url.pathname).toBe('/staff/provider-applicants');
    expect(url.searchParams.get('applicant')).toBe(id);
    expect(url.searchParams.get('q')).toBe('Example & Other?next=https://foreign.test');
    expect(url.searchParams.has('next')).toBe(false);
  });
  it('drops malformed record references rather than treating them as destinations', () => {
    expect(applicantWorkspaceLink('https://foreign.test', 'Example')).toBe('https://emr.valorwell.org/staff/provider-applicants');
  });
});
