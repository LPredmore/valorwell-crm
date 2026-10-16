// Prepared only; execution deferred to Todoist task 42.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke } } }));
import { getZeffyDonationReport, ZEFFY_REPORT_TIMEOUT_MS } from './zeffy-donations';
const tenant = '00000000-0000-0000-0000-000000000001';
beforeEach(() => { invoke.mockReset(); });
afterEach(() => { vi.useRealTimers(); });
describe('bounded donation report request', () => {
  it('bounds even a stalled SDK/session promise and aborts the request', async () => {
    vi.useFakeTimers(); invoke.mockImplementation(() => new Promise(() => {}));
    const request = getZeffyDonationReport(tenant);
    const rejected = expect(request).rejects.toThrow(/took too long/);
    await vi.advanceTimersByTimeAsync(ZEFFY_REPORT_TIMEOUT_MS);
    await rejected;
    expect(invoke.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it('cancels an old tenant/session request immediately', async () => {
    invoke.mockImplementation(() => new Promise(() => {}));
    const controller = new AbortController();
    const request = getZeffyDonationReport(tenant, { signal: controller.signal });
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(invoke.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it('shows a useful known failure without forwarding arbitrary server details', async () => {
    invoke.mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify({
      code: 'ledger_unavailable', error: 'private@example.test',
    }), { status: 503 }) } });
    await expect(getZeffyDonationReport(tenant)).rejects.toThrow(/ledger could not be read/);
  });
  it('rejects wrong-scope report responses rather than presenting them as refreshed', async () => {
    invoke.mockResolvedValue({ data: { contractVersion: 'other', tenantId: 'foreign' }, error: null });
    await expect(getZeffyDonationReport(tenant)).rejects.toThrow(/contract/);
  });
});
