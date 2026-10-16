// Prepared only; execution deferred to Todoist task 42.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { getReport, auth } = vi.hoisted(() => ({ getReport: vi.fn(), auth: {
  currentTenantId: '00000000-0000-0000-0000-000000000001', userId: 'operator', crmRole: 'crm_operator',
  capabilities: { report: true }, isAuthenticated: true,
} }));
vi.mock('@/hooks/crm/useCrmAuth', () => ({ useCrmAuth: () => auth }));
vi.mock('@/repositories/supabase/zeffy-donations', () => ({ getZeffyDonationReport: getReport }));
import ZeffyDonationsPage from './ZeffyDonationsPage';
const report = () => ({ contractVersion: 'zeffy-donation-summary.v1', tenantId: auth.currentTenantId,
  coverage: 'reconciled_payments_only', attribution: 'not_established',
  sources: [{ sourceAccountId: 'source', organizationId: 'org', campaignId: 'campaign', enabled: false }],
  currencies: [], pendingPayments: '0', lastObservedAt: null });
let client: QueryClient;
beforeEach(() => {
  getReport.mockReset(); auth.currentTenantId = '00000000-0000-0000-0000-000000000001'; auth.capabilities.report = true;
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, refetchOnWindowFocus: false } } });
});
afterEach(() => { cleanup(); client.clear(); });
const view = () => <QueryClientProvider client={client}><ZeffyDonationsPage /></QueryClientProvider>;
describe('donation report refresh feedback', () => {
  it('shows progress and a persistent paused completion even when amounts do not change', async () => {
    let resolve!: (value: ReturnType<typeof report>) => void;
    getReport.mockResolvedValueOnce(report()).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    render(view()); await screen.findByText(/No payment snapshots have been recorded/);
    const button = screen.getByRole('button', { name: 'Refresh report' });
    fireEvent.click(button);
    await waitFor(() => expect(button.getAttribute('aria-busy')).toBe('true'));
    expect(button.hasAttribute('disabled')).toBe(true);
    fireEvent.click(button); expect(getReport).toHaveBeenCalledTimes(2);
    resolve(report());
    await screen.findByText(/Report refreshed at/);
    expect(screen.getByText(/Last successful report load:/)).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/reconciliation is paused/i));
  });
  it('makes refresh failures visible and hides previous financial totals', async () => {
    const populated = { ...report(), currencies: [{ currency: 'USD', sourceType: 'online', paymentsRecorded: '1', completedPayments: '1',
      grossCents: '7500', refundedCents: '0', netCents: '7500', websiteCandidates: '1', requiresReview: '0' }] };
    getReport.mockResolvedValueOnce(populated).mockRejectedValueOnce(new Error('The donation ledger could not be read.'));
    render(view()); await screen.findAllByText('USD 75.00');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh report' }));
    await screen.findByRole('alert');
    expect(screen.queryByText('USD 75.00')).toBeNull();
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Refresh failed/));
  });
  it('resets refresh feedback and cached scope when the tenant changes', async () => {
    getReport.mockImplementation(async () => report());
    const rendered = render(view()); await screen.findByText(/No payment snapshots/);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh report' })); await screen.findByText(/Report refreshed at/);
    auth.currentTenantId = '00000000-0000-0000-0000-000000000002';
    rendered.rerender(view()); await screen.findByText(/No payment snapshots/);
    expect(screen.queryByText(/Report refreshed at/)).toBeNull();
    expect(getReport.mock.calls[getReport.mock.calls.length - 1]?.[0]).toBe(auth.currentTenantId);
  });
});
