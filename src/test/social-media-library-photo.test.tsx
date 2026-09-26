import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SocialMediaLibraryCard } from '@/components/crm/social-media/SocialMediaLibraryCard';
import type { SocialMediaLibraryItem } from '@/lib/crm/social-media';

const auth = vi.hoisted(() => ({ isAuthenticated: true, isLoading: false, capabilities: { mutate: true } }));
vi.mock('@/hooks/crm/useCrmAuth', () => ({ useCrmAuth: () => auth }));
vi.mock('@/components/crm/social-media/SocialMediaThumbnail', () => ({
  SocialMediaThumbnail: () => <div data-testid="cover-preview" />,
}));

const item: SocialMediaLibraryItem = {
  sourceType: 'clip',
  sourceId: 'clip-1',
  projectId: 'project-1',
  clipId: 'clip-1',
  contentFormat: 'short',
  title: 'A Beyond the Yellow Short',
  description: null,
  thumbnailUrl: null,
  thumbnailFileId: 'drive-file-id',
  guestName: null,
  organizationName: null,
  durationSeconds: 30,
  sourceFileId: 'video-file',
  sourceFileUrl: null,
  readiness: { ready: true, reasons: [] },
  activePublication: null,
  publishedPublication: null,
  failedPublication: null,
  latestPublication: null,
  defaultPlaylistName: 'BTY Shorts',
};

describe('Social Media Library photo editor access', () => {
  it('offers Change photo separately from publishing for an authorized operator', () => {
    auth.capabilities.mutate = true;
    const changePhoto = vi.fn();
    render(<SocialMediaLibraryCard item={item} onSelect={vi.fn()} onChangePhoto={changePhoto} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change photo' }));
    expect(changePhoto).toHaveBeenCalledOnce();
  });

  it('offers Add photo when a full-length episode has no cover', () => {
    auth.capabilities.mutate = true;
    render(<SocialMediaLibraryCard item={{
      ...item, sourceType: 'project', sourceId: 'project-1',
      clipId: null, contentFormat: 'full_episode', thumbnailFileId: null,
    }} onSelect={vi.fn()} onChangePhoto={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Add photo' })).toBeInTheDocument();
  });

  it('shows Thumbnail needed for a scheduled Short awaiting the manual Studio step', () => {
    auth.capabilities.mutate = true;
    render(<SocialMediaLibraryCard item={{
      ...item,
      activePublication: {
        id: 'pub-1',
        status: 'scheduled',
        deliveryMode: 'scheduled',
        scheduledFor: '2026-09-24T18:00:00.000Z',
        desiredPrivacyStatus: 'public',
        externalVideoId: 'yt-1',
        externalUrl: 'https://youtube.com/watch?v=yt-1',
        thumbnailStatus: 'manual_required',
      },
    }} onSelect={vi.fn()} onChangePhoto={vi.fn()} />);
    expect(screen.getByText('Thumbnail needed')).toBeInTheDocument();
  });

  it('does not offer the mutation to read-only CRM users', () => {
    auth.capabilities.mutate = false;
    render(<SocialMediaLibraryCard item={item} onSelect={vi.fn()} onChangePhoto={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Change photo' })).not.toBeInTheDocument();
    // Opening the editor for an unpublished source creates a draft, so readonly users are not offered it.
    expect(screen.queryByRole('button', { name: 'Create Publication' })).not.toBeInTheDocument();
    expect(screen.getByText('Not published yet')).toBeInTheDocument();
  });

  it('still lets read-only CRM users open an existing publication', () => {
    auth.capabilities.mutate = false;
    const onSelect = vi.fn();
    render(<SocialMediaLibraryCard item={{
      ...item,
      failedPublication: {
        id: 'pub-2', status: 'failed', deliveryMode: 'immediate', scheduledFor: null,
        desiredPrivacyStatus: 'public', externalVideoId: null, externalUrl: null, thumbnailStatus: null,
      },
    }} onSelect={onSelect} onChangePhoto={vi.fn()} />);
    expect(screen.getByText('Failed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View / Edit' }));
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
