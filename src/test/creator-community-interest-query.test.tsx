import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCreatorCommunityInterestQueue } from '@/hooks/crm/useCreatorCommunityInterest';

interface CapturedRequest {
  table: string;
  columns: string;
  order?: { column: string; ascending: boolean };
  limit?: number;
}

const boundary = vi.hoisted(() => ({ requests: [] as CapturedRequest[] }));

vi.mock('@/hooks/crm/useCrmAuth', () => ({
  useCrmAuth: () => ({
    tenantId: 'tenant-a',
    userId: 'profile-a',
    isAuthenticated: true,
    capabilities: { mutate: true },
  }),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      const request: CapturedRequest = { table, columns: '' };
      const result = () => {
        if (table === 'relationship_influencer_profiles') {
          return { data: [{ contact_id: 'contact-a', motivation: 'Serve', veteran_connection: null, highest_follower_platform: null, highest_follower_count: null, personal_mission: null, avatar_url: null }], error: null };
        }
        if (table === 'relationship_contacts') {
          return { data: [{
            id: 'contact-a', tenant_id: 'tenant-a', first_name: 'Casey', last_name: 'Test', preferred_name: null,
            email: 'casey@example.test', phone: null, state: 'TX', veteran_affiliation: 'none', outreach_status: 'new',
            review_state: 'review_needed', owner_profile_id: null, next_action: null, next_action_due_at: null,
            do_not_contact: false, source: 'valorwell_website_interest', created_at: '2026-07-18T00:00:00Z', updated_at: '2026-07-18T00:00:00Z',
          }], error: null };
        }
        return { data: [], error: null };
      };
      const chain = {
        select(columns: string) { request.columns = columns; boundary.requests.push(request); return chain; },
        eq() { return chain; },
        in() { return chain; },
        order(column: string, options: { ascending: boolean }) { request.order = { column, ascending: options.ascending }; return chain; },
        limit(value: number) { request.limit = value; return chain; },
        then(onFulfilled: (value: ReturnType<typeof result>) => unknown, onRejected?: (reason: unknown) => unknown) {
          return Promise.resolve(result()).then(onFulfilled, onRejected);
        },
      };
      return chain;
    },
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
}

describe('creator/community interest queue query boundary', () => {
  beforeEach(() => { boundary.requests.length = 0; });

  it('uses minimal explicit projections and bounds the conflict payload feed', async () => {
    const { result } = renderHook(() => useCreatorCommunityInterestQueue(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const requestsFor = (table: string) => boundary.requests.filter((request) => request.table === table);
    expect(boundary.requests.every(({ columns }) => columns !== '*')).toBe(true);
    expect(requestsFor('relationship_influencer_profiles')[0].columns).not.toMatch(/metadata|additional_info|fundraising_goal/);
    expect(requestsFor('relationship_contacts')[0].columns).not.toMatch(/metadata|source_record_key/);
    expect(requestsFor('relationship_contact_roles').every(({ columns }) => !columns.includes('metadata'))).toBe(true);
    expect(requestsFor('relationship_social_profiles')[0].columns).not.toMatch(/metadata|source/);

    const conflictRequest = requestsFor('relationship_interest_submission_conflicts')[0];
    expect(conflictRequest.columns).toContain('payload');
    expect(conflictRequest.order).toEqual({ column: 'submitted_at', ascending: false });
    expect(conflictRequest.limit).toBe(25);
  });
});
