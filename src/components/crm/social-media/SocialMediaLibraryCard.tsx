import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CONTENT_FORMAT_LABELS, STATUS_LABELS, type SocialMediaLibraryItem } from '@/lib/crm/social-media';
import { SocialMediaThumbnail } from './SocialMediaThumbnail';

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60);
  return `${minutes}:${String(remaining).padStart(2, '0')}`;
}

export function SocialMediaLibraryCard({ item, onSelect }: { item: SocialMediaLibraryItem; onSelect: () => void }) {
  const publication = item.activePublication ?? item.publishedPublication;

  return (
    <Card className="overflow-hidden">
      <SocialMediaThumbnail item={item} />
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="secondary">{CONTENT_FORMAT_LABELS[item.contentFormat]}</Badge>
          {!item.readiness.ready && <Badge variant="destructive">Not Ready</Badge>}
          {publication && <Badge variant="outline">{STATUS_LABELS[publication.status]}</Badge>}
        </div>
        <p className="text-sm font-medium line-clamp-2">{item.title ?? '(untitled)'}</p>
        <p className="text-xs text-muted-foreground">
          {[item.guestName, item.organizationName].filter(Boolean).join(' · ') || '—'}
        </p>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{formatDuration(item.durationSeconds)}</span>
          <span>{item.defaultPlaylistName}</span>
        </div>
        {!item.readiness.ready && (
          <p className="text-xs text-destructive">{item.readiness.reasons[0]}</p>
        )}
        <Button size="sm" variant="outline" className="w-full" onClick={onSelect}>
          {publication ? 'View / Edit' : 'Create Publication'}
        </Button>
      </CardContent>
    </Card>
  );
}
