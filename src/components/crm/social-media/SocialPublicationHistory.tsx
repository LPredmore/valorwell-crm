import { useQuery } from '@tanstack/react-query';
import { fetchPublicationEvents } from '@/lib/crm/social-media';

const EVENT_LABELS: Record<string, string> = {
  created: 'Created',
  status_changed: 'Status changed',
  upload_started: 'Upload started',
  youtube_video_created: 'YouTube video created',
  thumbnail_applied: 'Thumbnail applied',
  thumbnail_failed: 'Thumbnail failed',
  playlist_attached: 'Playlist attached',
};

export function SocialPublicationHistory({ publicationId }: { publicationId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['social-media', 'publication-events', publicationId],
    queryFn: () => fetchPublicationEvents(publicationId),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading history…</p>;
  if (!data?.length) return <p className="text-sm text-muted-foreground">No history yet.</p>;

  return (
    <ol className="space-y-2">
      {data.map((event) => (
        <li key={event.id} className="text-sm border-l-2 pl-3">
          <span className="font-medium">{EVENT_LABELS[event.event_type] ?? event.event_type}</span>
          {event.from_status && event.to_status && (
            <span className="text-muted-foreground"> — {event.from_status} → {event.to_status}</span>
          )}
          <div className="text-xs text-muted-foreground">{new Date(event.created_at).toLocaleString()}</div>
        </li>
      ))}
    </ol>
  );
}
