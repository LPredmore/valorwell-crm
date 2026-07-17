import type { PropsWithChildren } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CrmAuthCtx } from '@/contexts/crmAuthContextValue';
import { useReports } from '@/hooks/canonical/useCrmData';

const reportMethods = vi.hoisted(() => ({
  campaignPerformance: vi.fn(),
  closureMetrics: vi.fn(),
  engagementMetrics: vi.fn(),
  exceptionMetrics: vi.fn(),
  journeyFunnel: vi.fn(),
  taskPerformance: vi.fn(),
}));

vi.mock('@/services/dataProvider', () => ({
  dataProvider: { reports: reportMethods },
}));

describe('useReports active-tenant flow', () => {
  beforeEach(() => {
    for (const method of Object.values(reportMethods)) {
      method.mockReset();
      method.mockResolvedValue(null);
    }
  });

  it('passes the selected tenant to all six methods and isolates every query key', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    function Wrapper({ children }: PropsWithChildren) {
      return (
        <CrmAuthCtx.Provider value={{
          userId: 'user-a',
          tenantId: 'tenant-a',
          currentTenantId: 'tenant-a',
          availableTenants: [{ tenant_id: 'tenant-a', crm_role: 'crm_operator' }],
          crmRole: 'crm_operator',
          role: 'staff',
          capabilities: { mutate: true, communicate: true, manage_campaigns: true, report: true },
          contractVersion: 'valorwell-crm-contracts@1.0.1+20260714',
          isLoading: false,
          isAuthenticated: true,
          needsTenantSelection: false,
          switchTenant: async () => {},
          refresh: async () => {},
        }}>
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </CrmAuthCtx.Provider>
      );
    }

    renderHook(() => useReports(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(reportMethods.journeyFunnel).toHaveBeenCalledWith('tenant-a');
      expect(reportMethods.engagementMetrics).toHaveBeenCalledWith('tenant-a');
      expect(reportMethods.closureMetrics).toHaveBeenCalledWith('tenant-a');
      expect(reportMethods.campaignPerformance).toHaveBeenCalledWith('tenant-a');
      expect(reportMethods.taskPerformance).toHaveBeenCalledWith('tenant-a');
      expect(reportMethods.exceptionMetrics).toHaveBeenCalledWith('tenant-a');
    });

    const keys = queryClient.getQueryCache().getAll().map(query => query.queryKey);
    expect(keys).toEqual(expect.arrayContaining([
      ['report-funnel', 'tenant-a'],
      ['report-engagement', 'tenant-a'],
      ['report-closure', 'tenant-a'],
      ['report-campaign', 'tenant-a'],
      ['report-task', 'tenant-a'],
      ['report-exception', 'tenant-a'],
    ]));
  });
});
