import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CONTENT_FORMAT_LABELS, STATUS_LABELS, type SocialPublication } from '@/lib/crm/social-media';
import { SocialMediaThumbnail } from './SocialMediaThumbnail';
import { formatCentralDateTime } from './centralTime';
import { visibilityLabel } from './publicationViews';

export function SocialPublishingQueueItem({ publication, onOpen }: { publication: SocialPublication; onOpen: () => void }) {
  const playlists = publication.playlists.map((playlist) => playlist.displayName).filter(Boolean);
  const youtubeState = [publication.platformUploadStatus, publication.platformProcessingStatus].filter(Boolean);

  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-3">
        <div className="w-28 shrink-0 rounded overflow-hidden border">
          <SocialMediaThumbnail
            className="aspect-video"
            item={{
              sourceType: publication.sourceType,
              sourceId: publication.clipId ?? publication.projectId,
              thumbnailFileId: publication.thumbnailFileId,
            }}
          />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary">{CONTENT_FORMAT_LABELS[publication.contentFormat]}</Badge>
            <Badge variant="outline">{STATUS_LABELS[publication.status]}</Badge>
            <Badge variant="outline">{visibilityLabel(publication)}</Badge>
            {publication.thumbnailStatus === 'manual_required' && (
              <Badge variant="outline" className="border-amber-500 text-amber-700">Thumbnail needed</Badge>
            )}
            {publication.attemptCount > 1 && <Badge variant="destructive">Attempt {publication.attemptCount}</Badge>}
          </div>
          <p className="text-sm font-medium truncate">{publication.title ?? '(untitled)'}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-xs text-muted-foreground">
            {publication.scheduledFor && (<><dt>Scheduled</dt><dd>{formatCentralDateTime(publication.scheduledFor)}</dd></>)}
            <dt>Playlists</dt><dd className="truncate">{playlists.length ? playlists.join(', ') : 'None'}</dd>
            {youtubeState.length > 0 && (<><dt>YouTube</dt><dd>upload {publication.platformUploadStatus ?? '—'} · processing {publication.platformProcessingStatus ?? '—'}</dd></>)}
          </dl>
          {publication.errorMessage && <p className="text-xs text-destructive line-clamp-2">{publication.errorMessage}</p>}
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          {publication.externalUrl && (
            <Button size="sm" variant="secondary" asChild>
              <a href={publication.externalUrl} target="_blank" rel="noreferrer">Open</a>
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={onOpen}>View</Button>
        </div>
      </CardContent>
    </Card>
  );
}
