import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CONTENT_FORMAT_LABELS, STATUS_LABELS, type SocialPublication } from '@/lib/crm/social-media';

export function SocialPublishingQueueItem({ publication, onOpen }: { publication: SocialPublication; onOpen: () => void }) {
  return (
    <Card>
      <CardContent className="p-3 flex items-center justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{CONTENT_FORMAT_LABELS[publication.contentFormat]}</Badge>
            <Badge variant="outline">{STATUS_LABELS[publication.status]}</Badge>
            {publication.attemptCount > 1 && <Badge variant="destructive">Attempt {publication.attemptCount}</Badge>}
          </div>
          <p className="text-sm font-medium truncate">{publication.title ?? '(untitled)'}</p>
          {publication.errorMessage && <p className="text-xs text-destructive truncate">{publication.errorMessage}</p>}
          {publication.scheduledFor && (
            <p className="text-xs text-muted-foreground">Scheduled: {new Date(publication.scheduledFor).toLocaleString()}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
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
