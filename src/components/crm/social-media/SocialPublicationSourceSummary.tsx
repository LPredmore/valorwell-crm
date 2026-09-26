import { Badge } from '@/components/ui/badge';
import { CONTENT_FORMAT_LABELS, type SocialPublication } from '@/lib/crm/social-media';
import { SocialMediaThumbnail } from './SocialMediaThumbnail';

function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = Math.round(seconds % 60);
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
    : `${minutes}:${String(remaining).padStart(2, '0')}`;
}

/** What exactly is about to be published, so the operator can confirm the media before approving. */
export function SocialPublicationSourceSummary({ publication }: { publication: SocialPublication }) {
  const source = publication.source;
  const sourceLabel = publication.sourceType === 'project' ? 'Full episode source' : source?.clipType === 'short' ? 'Short clip' : 'Rendered part';

  return (
    <div className="flex gap-3 rounded-md border p-3">
      <div className="w-36 shrink-0 rounded overflow-hidden border">
        <SocialMediaThumbnail
          item={{ sourceType: publication.sourceType, sourceId: publication.clipId ?? publication.projectId, thumbnailFileId: publication.thumbnailFileId }}
        />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs min-w-0">
        <dt className="text-muted-foreground">Format</dt><dd>{CONTENT_FORMAT_LABELS[publication.contentFormat]}</dd>
        <dt className="text-muted-foreground">Source</dt><dd>{sourceLabel}</dd>
        <dt className="text-muted-foreground">Guest</dt><dd className="truncate">{source?.guestName ?? '—'}</dd>
        <dt className="text-muted-foreground">Organization</dt><dd className="truncate">{source?.organizationName ?? '—'}</dd>
        <dt className="text-muted-foreground">Duration</dt><dd>{formatDuration(source?.durationSeconds)}</dd>
        {source?.sourceFileName && (<><dt className="text-muted-foreground">File</dt><dd className="truncate">{source.sourceFileName}</dd></>)}
        <dt className="text-muted-foreground">Media</dt>
        <dd className="flex flex-wrap gap-1">
          {source ? (
            <>
              <Badge variant={source.mediaReady ? 'secondary' : 'destructive'}>{source.mediaReady ? 'In Drive' : 'Not ready'}</Badge>
              {source.renderVerified !== null && (
                <Badge variant={source.renderVerified ? 'secondary' : 'destructive'}>
                  {source.renderVerified ? '1080×1920 verified' : 'Render not verified'}
                </Badge>
              )}
            </>
          ) : '—'}
        </dd>
      </dl>
    </div>
  );
}
