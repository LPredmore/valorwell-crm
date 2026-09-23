import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchSocialThumbnailUrl, type SocialMediaLibraryItem } from '@/lib/crm/social-media';

/** Signed URLs live one hour server-side; refetch a little before that so a long-open Library
 * tab never shows an expired image. */
const SIGNED_URL_REFRESH_MS = 50 * 60 * 1000;

/**
 * Renders a library card's cover image. Private Drive covers are mirrored server-side and
 * reached through a time-limited signed URL, fetched only once the card scrolls into view so
 * opening the Library doesn't kick off twenty downloads at once. No cover configured, or a
 * per-card failure, renders a blank neutral area -- never a broken-image icon, and never a
 * failure that escapes to the whole page.
 */
export function SocialMediaThumbnail({ item }: { item: SocialMediaLibraryItem }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    const node = containerRef.current;
    if (!node || visible) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
    }, { rootMargin: '200px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  const enabled = visible && Boolean(item.thumbnailFileId);
  const { data } = useQuery({
    queryKey: ['social-media', 'thumbnail', item.sourceType, item.sourceId, item.thumbnailFileId],
    queryFn: () => fetchSocialThumbnailUrl(item.sourceType, item.sourceId),
    enabled,
    retry: 1,
    staleTime: SIGNED_URL_REFRESH_MS,
    refetchInterval: SIGNED_URL_REFRESH_MS,
    refetchOnWindowFocus: false,
  });

  const signedUrl = imageFailed ? null : data?.signedUrl ?? null;

  return (
    <div ref={containerRef} className="aspect-video bg-muted overflow-hidden" data-testid="social-thumbnail">
      {signedUrl && (
        <img
          src={signedUrl}
          alt=""
          loading="lazy"
          className="h-full w-full object-contain"
          onError={() => setImageFailed(true)}
        />
      )}
    </div>
  );
}
