import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ShortThumbnailBackfillButton } from '@/components/crm/social-media/ShortThumbnailBackfillButton';
import { backfillShortThumbnails, fetchShortsThumbnailFeature, type SocialPublication } from '@/lib/crm/social-media';

const toastMock = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ toast: toastMock }));
vi.mock('@/hooks/crm/useCrmAuth', () => ({ useCrmAuth: () => ({ capabilities: { mutate: true }, isAuthenticated: true, isLoading: false }) }));
vi.mock('@/lib/crm/social-media', async () => {
  const actual = await vi.importActual<typeof import('@/lib/crm/social-media')>('@/lib/crm/social-media');
  return { ...actual, fetchShortsThumbnailFeature: vi.fn(), backfillShortThumbnails: vi.fn() };
});

const feature = vi.mocked(fetchShortsThumbnailFeature);
const backfill = vi.mocked(backfillShortThumbnails);
const pub = (over: Partial<SocialPublication> = {}) => ({
  id: 'pub-1', title: 'Short A', contentFormat: 'short', status: 'scheduled', thumbnailStatus: 'manual_required',
  thumbnailFileId: 'file-1', externalVideoId: 'vid12345678', ...over,
}) as SocialPublication;
const wrap = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

beforeEach(() => { vi.clearAllMocks(); });

describe('ShortThumbnailBackfillButton', () => {
  it('hidden while the channel gate is off, and never posts on render', async () => {
    feature.mockResolvedValue({ automaticUploadsEnabled: false } as never);
    render(<ShortThumbnailBackfillButton publication={pub()} />, { wrapper: wrap });
    await waitFor(() => expect(feature).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /automatic thumbnail/i })).toBeNull();
    expect(backfill).not.toHaveBeenCalled();
  });

  it.each([
    ['manual_confirmed', { thumbnailStatus: 'manual_confirmed' }],
    ['api_confirmed', { thumbnailStatus: 'api_confirmed' }],
    ['no saved image', { thumbnailFileId: null }],
    ['no YouTube id', { externalVideoId: null }],
    ['not a Short', { contentFormat: 'long_form' }],
  ])('hidden when ineligible: %s', async (_n, over) => {
    feature.mockResolvedValue({ automaticUploadsEnabled: true } as never);
    render(<ShortThumbnailBackfillButton publication={pub(over as Partial<SocialPublication>)} />, { wrapper: wrap });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('button', { name: /automatic thumbnail/i })).toBeNull();
    expect(backfill).not.toHaveBeenCalled();
  });

  it('eligible + gate on: confirm sends exactly one id and reports the result', async () => {
    feature.mockResolvedValue({ automaticUploadsEnabled: true } as never);
    backfill.mockResolvedValue({ queued: ['pub-1'], skipped: [] });
    render(<ShortThumbnailBackfillButton publication={pub()} />, { wrapper: wrap });
    fireEvent.click(await screen.findByRole('button', { name: /try automatic thumbnail/i }));
    expect(backfill).not.toHaveBeenCalled();
    expect(screen.getByText(/changes the real YouTube thumbnail/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /apply thumbnail/i }));
    await waitFor(() => expect(backfill).toHaveBeenCalledTimes(1));
    expect(backfill).toHaveBeenCalledWith(['pub-1']);
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Thumbnail queued' })));
  });

  it('reports a skipped reason', async () => {
    feature.mockResolvedValue({ automaticUploadsEnabled: true } as never);
    backfill.mockResolvedValue({ queued: [], skipped: [{ id: 'pub-1', reason: 'not manual_required' }] });
    render(<ShortThumbnailBackfillButton publication={pub()} />, { wrapper: wrap });
    fireEvent.click(await screen.findByRole('button', { name: /try automatic thumbnail/i }));
    fireEvent.click(screen.getByRole('button', { name: /apply thumbnail/i }));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Not queued', description: 'not manual_required' })));
  });
});
