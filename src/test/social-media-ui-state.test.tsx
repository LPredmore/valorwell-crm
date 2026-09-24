import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({ capabilities: { mutate: true } as Record<string, boolean>, isAuthenticated: true, isLoading: false }));
vi.mock('@/hooks/crm/useCrmAuth', () => ({ useCrmAuth: () => authState }));

const api = vi.hoisted(() => ({
  createSocialPublication: vi.fn(),
  fetchSocialPublications: vi.fn(),
  fetchSocialPublication: vi.fn(),
  validateSocialPublication: vi.fn(),
}));
vi.mock('@/lib/crm/social-media', async () => {
  const actual = await vi.importActual<typeof import('@/lib/crm/social-media')>('@/lib/crm/social-media');
  return { ...actual, ...api };
});

import { publicationPollInterval, type SocialPublication } from '@/lib/crm/social-media';
import { SocialPublicationEditor } from '@/components/crm/social-media/SocialPublicationEditor';
import { SocialPublishingQueue } from '@/components/crm/social-media/SocialPublishingQueue';
import { QUEUE_SECTIONS } from '@/components/crm/social-media/publicationViews';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function pub(overrides: Partial<SocialPublication>): SocialPublication {
  return {
    id: 'pub-1', tenantId: 't', accountId: 'a', sourceType: 'clip', clipId: 'clip-1', projectId: 'project-1',
    contentFormat: 'short', status: 'draft', deliveryMode: 'immediate', scheduledFor: null, desiredPrivacyStatus: 'private',
    externalVideoId: null, externalUrl: null, thumbnailStatus: null, title: 'A title', description: '', tags: [], hashtags: [],
    categoryId: '29', categoryName: 'Nonprofits', defaultLanguage: 'en', license: 'youtube', madeForKids: false,
    containsSyntheticMedia: false, embeddable: true, publicStatsViewable: true, notifySubscribers: true,
    thumbnailFileId: null, thumbnailUrl: null, thumbnailDelivery: null, youtubeVerification: null, youtubeSchedule: null,
    reconciliation: null, platformUploadStatus: null, platformProcessingStatus: null, approvedAt: null, uploadStartedAt: null,
    uploadedAt: null, publishedAt: null, attemptCount: 0, errorCode: null, errorMessage: null, playlists: [],
    createdAt: '2026-09-24T00:00:00.000Z', updatedAt: '2026-09-24T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset());
  api.validateSocialPublication.mockResolvedValue({ ok: true, errors: [], warnings: [] });
});

describe('publication editor capability gating', () => {
  it('never auto-creates a draft for a readonly user', async () => {
    authState.capabilities = { mutate: false };
    render(
      <SocialPublicationEditor open onOpenChange={vi.fn()} publicationId={null} createFrom={{ sourceType: 'clip', clipId: 'clip-1', projectId: 'project-1' }} />,
      { wrapper },
    );
    expect(await screen.findByText('This video has not been prepared for publishing yet.')).toBeInTheDocument();
    expect(api.createSocialPublication).not.toHaveBeenCalled();
  });

  it('creates the draft for an operator', async () => {
    authState.capabilities = { mutate: true };
    api.createSocialPublication.mockResolvedValue(pub({}));
    api.fetchSocialPublication.mockResolvedValue(pub({}));
    render(
      <SocialPublicationEditor open onOpenChange={vi.fn()} publicationId={null} createFrom={{ sourceType: 'clip', clipId: 'clip-1', projectId: 'project-1' }} />,
      { wrapper },
    );
    await waitFor(() => expect(api.createSocialPublication).toHaveBeenCalledOnce());
  });

  it('shows a readonly user the publication with every field disabled and no actions', async () => {
    authState.capabilities = { mutate: false };
    api.fetchSocialPublication.mockResolvedValue(pub({ status: 'ready' }));
    render(<SocialPublicationEditor open onOpenChange={vi.fn()} publicationId="pub-1" />, { wrapper });
    expect(await screen.findByDisplayValue('A title')).toBeDisabled();
    expect(screen.getByLabelText('Description')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(screen.getByText(/Read-only access/)).toBeInTheDocument();
  });

  it('does not offer Cancel for a video already on YouTube, and explains why', async () => {
    authState.capabilities = { mutate: true };
    api.fetchSocialPublication.mockResolvedValue(pub({
      status: 'scheduled', deliveryMode: 'scheduled', desiredPrivacyStatus: 'public',
      scheduledFor: new Date(Date.now() + 3_600_000).toISOString(), externalVideoId: 'vid-1',
    }));
    render(<SocialPublicationEditor open onOpenChange={vi.fn()} publicationId="pub-1" />, { wrapper });
    expect(await screen.findByText(/cannot be cancelled from the CRM/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reschedule' })).toBeInTheDocument();
  });
});

describe('publishing queue sections', () => {
  it('lists a Private upload under Uploaded / Private, never under Published', async () => {
    authState.capabilities = { mutate: true };
    api.fetchSocialPublications.mockResolvedValue([
      pub({ id: 'private-1', status: 'uploaded', title: 'Private upload', externalVideoId: 'v1' }),
      pub({ id: 'public-1', status: 'published', title: 'Public video', desiredPrivacyStatus: 'public', externalVideoId: 'v2' }),
    ]);
    render(<SocialPublishingQueue />, { wrapper });
    const uploadedTab = await screen.findByRole('tab', { name: 'Uploaded / Private (1)' });
    expect(screen.getByRole('tab', { name: 'Published (1)' })).toBeInTheDocument();
    fireEvent.mouseDown(uploadedTab);
    fireEvent.click(uploadedTab);
    const panel = await screen.findByRole('tabpanel');
    expect(within(panel).getByText('Private upload')).toBeInTheDocument();
    expect(within(panel).queryByText('Public video')).not.toBeInTheDocument();
  });

  it('has exactly one section per status', () => {
    const statuses = QUEUE_SECTIONS.flatMap((section) => section.statuses);
    expect(new Set(statuses).size).toBe(statuses.length);
    expect(statuses.sort()).toEqual(['approved', 'cancelled', 'draft', 'failed', 'published', 'ready', 'scheduled', 'upload_queued', 'uploaded', 'uploading']);
  });
});

describe('polling', () => {
  const now = Date.parse('2026-09-24T12:00:00.000Z');
  it('polls fast only while an upload is in flight', () => {
    expect(publicationPollInterval([{ status: 'uploading', scheduledFor: null }], now)).toBe(15_000);
    expect(publicationPollInterval([{ status: 'upload_queued', scheduledFor: null }], now)).toBe(15_000);
  });

  it('polls slowly while a scheduled video is about to be reconciled', () => {
    expect(publicationPollInterval([{ status: 'scheduled', scheduledFor: '2026-09-24T12:10:00.000Z' }], now)).toBe(60_000);
    expect(publicationPollInterval([{ status: 'scheduled', scheduledFor: '2026-09-24T11:00:00.000Z' }], now)).toBe(60_000);
  });

  it('does not poll stable states', () => {
    expect(publicationPollInterval([{ status: 'scheduled', scheduledFor: '2026-09-30T12:00:00.000Z' }], now)).toBe(false);
    expect(publicationPollInterval([
      { status: 'published', scheduledFor: null }, { status: 'uploaded', scheduledFor: null }, { status: 'draft', scheduledFor: null },
    ], now)).toBe(false);
    expect(publicationPollInterval([], now)).toBe(false);
  });
});
