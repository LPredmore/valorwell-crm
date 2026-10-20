import { beforeEach, describe, expect, it, vi } from 'vitest';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc } }));
import { listApplicantHandoffs, parseApplicantHandoffPage } from './applicant-handoff';

describe('staff-authorized applicant handoff reads', () => {
  beforeEach(() => vi.resetAllMocks());
  it('rejects mismatched staff tenant before requesting any applications', async () => {
    rpc.mockResolvedValue({ data: 'other-tenant', error: null });
    await expect(listApplicantHandoffs('selected-tenant', 1, 'all', '')).rejects.toThrow(/matching staff applicant access/);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('keeps staff-contract errors unavailable rather than presenting zero', async () => {
    rpc.mockResolvedValueOnce({ data: 'tenant', error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'Permission denied' } });
    await expect(listApplicantHandoffs('tenant', 1, 'ready', '')).rejects.toThrow('Permission denied');
  });
  it('requests source-side pagination and includes onboarding records', async () => {
    rpc.mockResolvedValueOnce({ data: 'tenant', error: null })
      .mockResolvedValueOnce({ data: { items: [], total: 51, page: 2, pageSize: 50 }, error: null });
    await expect(listApplicantHandoffs('tenant', 2, 'hired', '  Candidate  ')).resolves.toEqual({ items: [], total: 51 });
    expect(rpc).toHaveBeenLastCalledWith('staff_list_provider_applicants', {
      p_status: 'hired', p_search: 'Candidate', p_page: 2, p_page_size: 50,
    });
  });
  it('projects only authorized applicant fields and drops raw communication payloads', () => {
    const page = parseApplicantHandoffPage({ items: [{ id: 'applicant', firstName: 'A', lastName: 'B', status: 'ready',
      convertedStaffId: 'staff', ownerName: 'Recruiter', email: 'private@example.test', communications: [{ body: 'private' }] }],
    total: 1, page: 1, pageSize: 50 }, 1);
    expect(page.items[0]).toEqual({
      id: 'applicant', name: 'A B', status: 'ready', convertedStaffId: 'staff', ownerName: 'Recruiter',
      nextAction: null, nextActionDueAt: null,
      applicantOrigin: null, source: null, referralSource: null,
      email: 'private@example.test', phone: null, primaryState: null, licenseType: null,
    });
    expect(page.items[0]).not.toHaveProperty('communications');
  });
  it('rejects absent counts and unrecognized status contracts', () => {
    expect(() => parseApplicantHandoffPage({ items: [], page: 1, pageSize: 50 }, 1)).toThrow(/unsupported/);
    expect(() => parseApplicantHandoffPage({ items: [{ id: 'id', status: 'invited' }], total: 1, page: 1, pageSize: 50 }, 1)).toThrow(/Unsupported/);
  });
});
