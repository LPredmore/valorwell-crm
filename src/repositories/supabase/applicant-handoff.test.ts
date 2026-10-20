import { beforeEach, describe, expect, it, vi } from 'vitest';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc } }));
import { listApplicantHandoffs, listAllApplicantHandoffs, parseApplicantDirectoryPage, parseApplicantHandoffPage } from './applicant-handoff';

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
  it('discards contact and communication payloads from the handoff projection', () => {
    const page = parseApplicantHandoffPage({ items: [{ id: 'applicant', firstName: 'A', lastName: 'B', status: 'ready',
      convertedStaffId: 'staff', ownerName: 'Recruiter', email: 'private@example.test', communications: [{ body: 'private' }] }],
    total: 1, page: 1, pageSize: 50 }, 1);
    expect(page.items[0]).toEqual({ id: 'applicant', name: 'A B', status: 'ready', convertedStaffId: 'staff', ownerName: 'Recruiter', nextAction: null, nextActionDueAt: null });
  });
  it('allowlists explicit staff-directory fields without communication or application payloads', () => {
    const page = parseApplicantDirectoryPage({ items: [{ id: 'applicant', status: 'ready',
      email: 'staff-only@example.test', phone: 'synthetic', applicantOrigin: 'Website',
      primaryState: 'VA', licenseType: 'LCSW', communications: [{ body: 'private' }], application_data: { secret: 'private' } }],
      total: 1, page: 1, pageSize: 50 }, 1);
    expect(page.items[0]).toMatchObject({ email: 'staff-only@example.test', phone: 'synthetic', applicantOrigin: 'Website', primaryState: 'VA', licenseType: 'LCSW' });
    expect(page.items[0]).not.toHaveProperty('communications');
    expect(page.items[0]).not.toHaveProperty('application_data');
  });
  it('returns directory contact fields after the matching staff contract succeeds', async () => {
    rpc.mockResolvedValueOnce({ data: 'tenant', error: null }).mockResolvedValueOnce({ data: {
      items: [{ id: 'applicant', status: 'ready', email: 'staff-only@example.test' }], total: 1, page: 1, pageSize: 50,
    }, error: null });
    const result = await listAllApplicantHandoffs('tenant', 'all', '');
    expect(result.items[0].email).toBe('staff-only@example.test');
    expect(rpc).toHaveBeenCalledTimes(2);
  });
  it('requires matching staff tenant before directory contact fields can be requested', async () => {
    rpc.mockResolvedValue({ data: 'other-tenant', error: null });
    await expect(listAllApplicantHandoffs('selected-tenant', 'all', '')).rejects.toThrow(/matching staff applicant access/);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('rejects absent counts and unrecognized status contracts', () => {
    expect(() => parseApplicantHandoffPage({ items: [], page: 1, pageSize: 50 }, 1)).toThrow(/unsupported/);
    expect(() => parseApplicantHandoffPage({ items: [{ id: 'id', status: 'invited' }], total: 1, page: 1, pageSize: 50 }, 1)).toThrow(/Unsupported/);
  });
});
