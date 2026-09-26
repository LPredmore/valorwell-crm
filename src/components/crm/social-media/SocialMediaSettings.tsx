import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { fetchSocialMediaSettings, fetchYouTubeConnectionStatus } from '@/lib/crm/social-media';
import { YouTubeConnectionStatus } from './YouTubeConnectionStatus';
import { SocialMediaErrorState } from './SocialMediaErrorState';

function displayTime(time: string): string {
  const [hour, minute] = time.split(':').map(Number);
  return new Date(Date.UTC(2000, 0, 1, hour, minute)).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: minute === 0 ? undefined : '2-digit',
    timeZone: 'UTC',
  });
}

export function SocialMediaSettings() {
  const { data: settings, isLoading, error } = useQuery({
    queryKey: ['social-media', 'settings'],
    queryFn: fetchSocialMediaSettings,
    retry: 1,
  });
  // Query errors don't block rendering connection status separately -- Settings should show
  // whatever it has, not go fully blank because one of two independent requests failed.
  // Rendering only reads the recorded state; verifying against Google is an explicit action.
  const { data: connection, error: connectionError } = useQuery({
    queryKey: ['social-media', 'youtube-connection'],
    queryFn: fetchYouTubeConnectionStatus,
    retry: 1,
  });

  if (isLoading) return <p className="pt-4 text-sm text-muted-foreground">Loading…</p>;
  if (error) return <div className="pt-4"><SocialMediaErrorState error={error} /></div>;
  if (!settings) return <p className="pt-4 text-sm text-muted-foreground">No settings returned.</p>;

  const defaults = settings.defaults as Record<string, unknown> | null;

  return (
    <div className="pt-4 space-y-4 max-w-2xl">
      {connectionError ? <SocialMediaErrorState error={connectionError} /> : <YouTubeConnectionStatus status={connection} />}

      <Card>
        <CardHeader><CardTitle className="text-sm">Account</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-1">
          <p>{settings.account.displayName} ({settings.account.externalAccountId})</p>
          <p className="text-muted-foreground">Auth status: {settings.account.authStatus}</p>
          <p className="text-muted-foreground">
            Last verified: {settings.account.lastVerifiedAt ? new Date(settings.account.lastVerifiedAt).toLocaleString() : 'never'}
          </p>
        </CardContent>
      </Card>

      {defaults && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Defaults</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2 text-sm">
            <Badge variant="secondary">Timezone: {String(defaults.timezone)}</Badge>
            <Badge variant="secondary">Review required: {defaults.require_review_before_publish ? 'Yes' : 'No'}</Badge>
            <Badge variant="secondary">Category: {String(defaults.default_category_name)}</Badge>
            <Badge variant="secondary">Made for kids: {defaults.default_made_for_kids ? 'Yes' : 'No'}</Badge>
            <Badge variant="secondary">Synthetic media disclosure: {defaults.default_contains_synthetic_media ? 'Yes' : 'No'}</Badge>
            <Badge variant="secondary">License: {String(defaults.default_license)}</Badge>
            <Badge variant="secondary">Embedding: {defaults.default_embeddable ? 'Enabled' : 'Disabled'}</Badge>
            <Badge variant="secondary">Public stats: {defaults.default_public_stats_viewable ? 'Enabled' : 'Disabled'}</Badge>
            <Badge variant="secondary">Notify subscribers: {defaults.default_notify_subscribers ? 'Yes' : 'No'}</Badge>
            <Badge variant="secondary">Custom thumbnails: {defaults.default_use_custom_thumbnail ? 'Yes' : 'No'}</Badge>
            <Badge variant="secondary">Immediate visibility: {String(defaults.default_immediate_privacy_status)}</Badge>
            <Badge variant="secondary">Schedule strategy: {String(defaults.schedule_strategy)}</Badge>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-sm">Preferred publishing times</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-24 font-medium">Shorts</span>
            {settings.preferredScheduleTimes.short.map((time) => <Badge key={time} variant="secondary">{displayTime(time)}</Badge>)}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-24 font-medium">Long form</span>
            {settings.preferredScheduleTimes.longForm.map((time) => <Badge key={time} variant="secondary">{displayTime(time)}</Badge>)}
          </div>
          <p className="text-xs text-muted-foreground">Bulk scheduling uses these slots in {settings.timezone}, spreading the first slot across all selected days before moving to the next slot.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Default routing</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm">
          {settings.routing.map((rule, index) => (
            <p key={index}>
              {rule.contentFormat === 'short' ? 'Short' : rule.contentFormat === 'long_form' ? 'Long Form' : 'Full Episode'}
              {' → '}
              {rule.defaultPlaylistName}
            </p>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
