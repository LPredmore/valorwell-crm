import { AlertTriangle } from 'lucide-react';
import type { SocialPublication } from '@/lib/crm/social-media';
import { formatCentralDateTime } from './centralTime';

/**
 * What YouTube itself last reported for this video. Every post-upload status in the CRM is
 * derived from this evidence, so it is shown next to the status rather than hidden in logs.
 */
export function SocialPublicationYouTubeState({ publication }: { publication: SocialPublication }) {
  if (!publication.externalVideoId) return null;
  const verification = publication.youtubeVerification;
  const schedule = publication.youtubeSchedule;
  const reconciliation = publication.reconciliation;

  return (
    <div className="space-y-1.5 rounded-md border p-3 text-xs">
      <h4 className="text-sm font-medium">YouTube</h4>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        <dt className="text-muted-foreground">Video</dt>
        <dd className="font-mono">{publication.externalVideoId}</dd>
        <dt className="text-muted-foreground">Privacy</dt>
        <dd>{reconciliation?.privacyStatus ?? verification?.privacyStatus ?? schedule?.privacyStatus ?? '—'}</dd>
        <dt className="text-muted-foreground">Upload</dt>
        <dd>{publication.platformUploadStatus ?? '—'}</dd>
        <dt className="text-muted-foreground">Processing</dt>
        <dd>{publication.platformProcessingStatus ?? '—'}</dd>
        {publication.deliveryMode === 'scheduled' && (
          <>
            <dt className="text-muted-foreground">Publishes at</dt>
            <dd>
              {schedule?.youtubePublishAt ? formatCentralDateTime(schedule.youtubePublishAt) : '—'}
              {schedule?.apiStatus === 'verified' && ' (confirmed by YouTube)'}
            </dd>
          </>
        )}
        {publication.publishedAt && (<><dt className="text-muted-foreground">Published</dt><dd>{formatCentralDateTime(publication.publishedAt)}</dd></>)}
        {(reconciliation?.checkedAt ?? verification?.checkedAt) && (
          <><dt className="text-muted-foreground">Last checked</dt><dd>{formatCentralDateTime((reconciliation?.checkedAt ?? verification?.checkedAt) as string)}</dd></>
        )}
      </dl>
      {reconciliation?.state === 'exception' && (
        <p className="flex items-start gap-1.5 text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          {reconciliation.reason ?? 'YouTube reports a state that does not match this publication.'} Check the video in YouTube Studio.
        </p>
      )}
      {verification?.state === 'unconfirmed' && (
        <p className="text-amber-700 dark:text-amber-400">{verification.reason}</p>
      )}
    </div>
  );
}
