import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  CONTENT_FORMAT_LABELS, primaryPublication, STATUS_LABELS, type SocialMediaLibraryItem,
} from '@/lib/crm/social-media';
import { SocialMediaThumbnail } from './SocialMediaThumbnail';
import { CrmMutationGate } from '@/components/crm/auth/CrmMutationGate';
import { visibilityLabel } from './publicationViews';
import { formatCentralDateTime } from './centralTime';

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60);
  return `${minutes}:${String(remaining).padStart(2, '0')}`;
}

export function SocialMediaLibraryCard({ item, onSelect, onChangePhoto }: { item: SocialMediaLibraryItem; onSelect: () => void; onChangePhoto: () => void }) {
  const publication = primaryPublication(item);

  return (
    <Card className="overflow-hidden">
      <SocialMediaThumbnail item={item} />
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="secondary">{CONTENT_FORMAT_LABELS[item.contentFormat]}</Badge>
          {!item.readiness.ready && <Badge variant="destructive">Not Ready</Badge>}
          {publication && (
            <Badge variant={publication.status === 'failed' ? 'destructive' : 'outline'}>{STATUS_LABELS[publication.status]}</Badge>
          )}
          {publication?.thumbnailStatus === 'manual_required' && (
            <Badge variant="outline" className="border-amber-500 text-amber-700">Thumbnail needed</Badge>
          )}
          {publication?.thumbnailStatus === 'manual_confirmed' && (
            <Badge variant="outline" className="border-emerald-500 text-emerald-700">Thumbnail done</Badge>
          )}
        </div>
        <p className="text-sm font-medium line-clamp-2">{item.title ?? '(untitled)'}</p>
        <p className="text-xs text-muted-foreground">
          {[item.guestName, item.organizationName].filter(Boolean).join(' · ') || '—'}
        </p>
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{formatDuration(item.durationSeconds)}</span>
          <span className="truncate" title="Default playlist">{item.defaultPlaylistName ?? 'No default playlist'}</span>
        </div>
        {publication && (publication.scheduledFor || publication.status !== 'draft') && (
          <p className="text-xs text-muted-foreground">
            {visibilityLabel(publication)}
            {publication.scheduledFor && ` · ${formatCentralDateTime(publication.scheduledFor)}`}
          </p>
        )}
        {!item.readiness.ready && (
          <p className="text-xs text-destructive">{item.readiness.reasons[0]}</p>
        )}
        <CrmMutationGate>
          <Button size="sm" variant="secondary" className="w-full" onClick={onChangePhoto}>
            {item.thumbnailFileId ? 'Change photo' : 'Add photo'}
          </Button>
        </CrmMutationGate>
        {publication ? (
          <Button size="sm" variant="outline" className="w-full" onClick={onSelect}>View / Edit</Button>
        ) : (
          // Opening the editor without a publication creates a draft, so readonly users
          // are never offered it.
          <CrmMutationGate readOnlyFallback={<p className="text-xs text-muted-foreground text-center">Not published yet</p>}>
            <Button size="sm" variant="outline" className="w-full" onClick={onSelect}>Create Publication</Button>
          </CrmMutationGate>
        )}
      </CardContent>
    </Card>
  );
}
