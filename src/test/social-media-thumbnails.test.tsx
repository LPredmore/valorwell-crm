import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const invokeMock = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invokeMock(...args) } },
}));

import { fetchSocialThumbnailUrl, type SocialMediaLibraryItem } from '@/lib/crm/social-media';
import { SocialMediaThumbnail } from '@/components/crm/social-media/SocialMediaThumbnail';

function item(overrides: Partial<SocialMediaLibraryItem> = {}): SocialMediaLibraryItem {
  return {
    sourceType: 'project',
    sourceId: 'project-1',
    projectId: 'project-1',
    clipId: null,
    contentFormat: 'full_episode',
    title: 'Episode',
    description: null,
    thumbnailUrl: null,
    thumbnailFileId: null,
    guestName: null,
    organizationName: null,
    durationSeconds: 100,
    sourceFileId: 'drive-source',
    sourceFileUrl: null,
    readiness: { ready: true, reasons: [] },
    activePublication: null,
    publishedPublication: null,
    defaultPlaylistName: null,
    ...overrides,
  };
}

function renderThumbnail(value: SocialMediaLibraryItem) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SocialMediaThumbnail item={value} />
    </QueryClientProvider>,
  );
}

describe('social media thumbnail access', () => {
  beforeEach(() => invokeMock.mockReset());

  it('asks the server for a signed URL by source row only, never by Drive file id', async () => {
    invokeMock.mockResolvedValue({ data: { data: { fileId: 'file-1', signedUrl: 'https://signed/1', expiresInSeconds: 3600 }, requestId: 'r' }, error: null });
    await fetchSocialThumbnailUrl('clip', 'clip-9');
    expect(invokeMock).toHaveBeenCalledWith('social-media-manager', {
      body: { action: 'get_thumbnail_url', sourceType: 'clip', sourceId: 'clip-9' },
      timeout: 15000,
    });
  });

  it('renders a blank neutral area and makes no request when no cover image is configured', async () => {
    renderThumbnail(item());
    await waitFor(() => expect(screen.getByTestId('social-thumbnail')).toBeTruthy());
    expect(screen.queryByRole('img')).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('renders the signed URL for a clip that has its own cover image', async () => {
    invokeMock.mockResolvedValue({ data: { data: { fileId: 'clip-cover', signedUrl: 'https://signed/clip', expiresInSeconds: 3600 }, requestId: 'r' }, error: null });
    renderThumbnail(item({ sourceType: 'clip', sourceId: 'clip-3', clipId: 'clip-3', contentFormat: 'short', thumbnailFileId: 'clip-cover' }));
    await waitFor(() => expect(screen.getByRole('img').getAttribute('src')).toBe('https://signed/clip'));
    expect(invokeMock).toHaveBeenCalledWith('social-media-manager', expect.objectContaining({
      body: { action: 'get_thumbnail_url', sourceType: 'clip', sourceId: 'clip-3' },
    }));
  });

  it('keeps the card blank when one thumbnail request fails instead of surfacing an error', async () => {
    invokeMock.mockResolvedValue({ data: { error: 'THUMBNAIL_SIGN_FAILED', requestId: 'r' }, error: null });
    renderThumbnail(item({ thumbnailFileId: 'file-broken' }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByTestId('social-thumbnail')).toBeTruthy();
  });
});

describe('library thumbnail source selection contract', () => {
  const librarySource = readFileSync('supabase/functions/social-media-manager/handlers/library.ts', 'utf8');
  const thumbnailSource = readFileSync('supabase/functions/social-media-manager/handlers/thumbnails.ts', 'utf8');

  it('never uses the guest portrait as an episode cover', () => {
    expect(librarySource).not.toMatch(/guest_image_url/);
    expect(thumbnailSource).not.toMatch(/guest_image_url/);
  });

  it('serves the project cover file id and no raw Drive view URL to the browser', () => {
    expect(librarySource).toMatch(/thumbnailFileId: project\.cover_image_file_id/);
    expect(librarySource).toMatch(/thumbnailFileId: clip\.cover_image_file_id/);
    expect(librarySource).not.toMatch(/thumbnailUrl: (clip|project)\./);
  });

  it('resolves the Drive file id from the tenant-scoped record and caches by file id', () => {
    expect(thumbnailSource).toMatch(/\.eq\("tenant_id", tenantId\)/);
    expect(thumbnailSource).toMatch(/ai_operations_video_projects\.tenant_id", tenantId/);
    expect(thumbnailSource).toMatch(/upsert: true/);
    expect(thumbnailSource).toMatch(/ALLOWED_THUMBNAIL_MIME_TYPES\.includes/);
    expect(thumbnailSource).toMatch(/MAX_THUMBNAIL_BYTES/);
  });
});
