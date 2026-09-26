import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SocialMediaSettings } from '@/components/crm/social-media/SocialMediaSettings';
import { fetchYouTubeConnectionStatus, verifyYouTubeConnection } from '@/lib/crm/social-media';

const authState = vi.hoisted(() => ({ capabilities: { mutate: true }, isAuthenticated: true, isLoading: false }));

vi.mock('@/hooks/crm/useCrmAuth', () => ({ useCrmAuth: () => authState }));

vi.mock('@/lib/crm/social-media', async () => {
  const actual = await vi.importActual<typeof import('@/lib/crm/social-media')>('@/lib/crm/social-media');
  return {
    ...actual,
    fetchSocialMediaSettings: vi.fn().mockResolvedValue({
      account: { id: 'account-1', displayName: 'ValorWell YouTube', externalAccountId: 'UCVcoBzMSzuABGxJ5Ne5EBtw', authStatus: 'configured', lastVerifiedAt: null },
      defaults: {
        timezone: 'America/Chicago', require_review_before_publish: true, default_category_name: 'Nonprofits & Activism',
        default_made_for_kids: false, default_contains_synthetic_media: false, default_license: 'youtube',
        default_embeddable: true, default_public_stats_viewable: true, default_notify_subscribers: true,
        default_use_custom_thumbnail: true, default_immediate_privacy_status: 'public', schedule_strategy: 'youtube_native_publish_at',
      },
      timezone: 'America/Chicago',
      preferredScheduleTimes: { short: ['12:00', '15:00', '18:00'], longForm: ['08:00', '14:00'] },
      routing: [{ sourceType: 'clip', sourceClipType: 'short', contentFormat: 'short', defaultPlaylistName: 'BTY Shorts' }],
      playlists: [],
    }),
    fetchYouTubeConnectionStatus: vi.fn().mockResolvedValue({ state: 'connected', channelId: 'UCVcoBzMSzuABGxJ5Ne5EBtw', channelTitle: 'ValorWell YouTube', missingScopes: [], reason: null, lastVerifiedAt: '2026-09-20T00:00:00.000Z', source: 'recorded' }),
    verifyYouTubeConnection: vi.fn().mockResolvedValue({ state: 'configured', channelId: null, channelTitle: null, missingScopes: [], reason: null }),
  };
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('Social Media Manager Settings capability gating', () => {
  it('shows the Verify Connection button for a user with mutate capability', async () => {
    authState.capabilities = { mutate: true };
    render(<SocialMediaSettings />, { wrapper });
    await waitFor(() => expect(screen.getByText('ValorWell YouTube (UCVcoBzMSzuABGxJ5Ne5EBtw)')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Verify Connection' })).toBeInTheDocument();
  });

  it('hides the Verify Connection button for a readonly user', async () => {
    authState.capabilities = { mutate: false };
    render(<SocialMediaSettings />, { wrapper });
    await waitFor(() => expect(screen.getByText('ValorWell YouTube (UCVcoBzMSzuABGxJ5Ne5EBtw)')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Verify Connection' })).not.toBeInTheDocument();
    // The readonly user can still see the routing and defaults -- view access is not gated.
    expect(screen.getByText(/Short → BTY Shorts/)).toBeInTheDocument();
  });

  it('renders the recorded connection state without verifying against Google', async () => {
    authState.capabilities = { mutate: false };
    vi.mocked(verifyYouTubeConnection).mockClear();
    render(<SocialMediaSettings />, { wrapper });
    await waitFor(() => expect(screen.getByText('connected')).toBeInTheDocument());
    expect(fetchYouTubeConnectionStatus).toHaveBeenCalled();
    expect(verifyYouTubeConnection).not.toHaveBeenCalled();
    expect(screen.getByText(/As of the last verification/)).toBeInTheDocument();
  });
});
