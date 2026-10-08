import { listRelationshipEmails } from '@/repositories/supabase/relationship-activity';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useCrmAuth } from '@/hooks/crm/useCrmAuth';
import { buildActivityTimeline, pageTimeline, type TimelineChannel } from '@/domain/relationships/activity-timeline';
import { dataProvider } from '@/services/dataProvider';

const PAGE_SIZE = 30;
const INTERACTION_PAGE_SIZE = 100;
type Subject = { contactId: string; organizationId?: never } | { organizationId: string; contactId?: never };
const channelOptions: Array<{ value: 'all' | TimelineChannel; title: string }> = [
  { value: 'all', title: 'All' },
  { value: 'email', title: 'Email' },
  { value: 'call', title: 'Calls' },
  { value: 'meeting', title: 'Meetings' },
  { value: 'note', title: 'Notes' },
  { value: 'system', title: 'Other activity' },
];

/** Non-clinical activity only. CRM email and relationship interaction source
 * records remain authoritative; clinical CRM events are never fetched here. */
export function RelationshipTimelinePanel({ subject }: { subject: Subject }) {
  const { currentTenantId } = useCrmAuth();
  const subjectKey = subject.contactId ? 'contact:' + subject.contactId : 'organization:' + subject.organizationId;
  const [interactionPage, setInteractionPage] = useState(1);
  const [emailPage, setEmailPage] = useState(1);
  const [displayPage, setDisplayPage] = useState(1);
  const [channel, setChannel] = useState<'all' | TimelineChannel>('all');
  const enabled = Boolean(currentTenantId) && Boolean(subject.contactId || subject.organizationId);
  const interactions = useQuery({
    queryKey: ['relationship-timeline-interactions', currentTenantId, subjectKey, interactionPage],
    queryFn: async () => {
      const requests = Array.from({ length: interactionPage }, (_, i) =>
        dataProvider.relationships.listInteractions(subject, { page: i + 1, pageSize: INTERACTION_PAGE_SIZE }),
      );
      const pages = await Promise.all(requests);
      return {
        rows: pages.flatMap(x => x.items),
        total: pages[0]?.total ?? 0,
      };
    },
    enabled, retry: false,
  });
  const communications = useQuery({
    queryKey: ['relationship-timeline-communications', currentTenantId, subjectKey, emailPage],
    queryFn: async () => {
      const pages = await Promise.all(Array.from({ length: emailPage }, (_, i) =>
        listRelationshipEmails(subject, i + 1),
      ));
      return { rows: pages.flatMap(x => x.items), total: pages[0]?.total ?? 0 };
    },
    enabled, retry: false,
  });
  const entries = useMemo(() => {
    const rows = buildActivityTimeline(interactions.data?.rows ?? [], communications.data?.rows ?? []);
    return channel === 'all' ? rows : rows.filter(x => x.channel === channel);
  }, [interactions.data, communications.data, channel]);

  const busy = interactions.isLoading || communications.isLoading;
  const error = interactions.error || communications.error;
  const hasMoreInteractions = (interactions.data?.rows.length ?? 0) < (interactions.data?.total ?? 0);
  const hasMoreEmails = (communications.data?.rows.length ?? 0) < (communications.data?.total ?? 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity &amp; communications</CardTitle>
        <CardDescription>
          A chronological view of recorded relationship interactions and actual email-delivery records.
          Delivery and reply states are shown only when supported by the source system.
          Clinical client communications and notes are excluded.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter activity by channel">
          {channelOptions.map(item => <Button key={item.value} size="sm"
            variant={channel === item.value ? 'default' : 'outline'}
            onClick={() => { setChannel(item.value); setDisplayPage(1); }}>{item.title}</Button>)}
        </div>
        {busy && <p className="text-sm text-muted-foreground">Loading activity history…</p>}
        {error && <p role="alert" className="text-sm text-destructive">
          Some activity could not be loaded: {error instanceof Error ? error.message : 'Access unavailable'}
        </p>}
        {!busy && !error && entries.length === 0 &&
          <p className="text-sm text-muted-foreground">No recorded activity for this contact or organization.</p>}
        {!error && <ol aria-label="Chronological relationship activity" className="divide-y rounded-md border">
          {pageTimeline(entries, displayPage, PAGE_SIZE).map(row => (
            <li key={row.key} className="flex flex-wrap items-start justify-between gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium capitalize">{row.title}</p>
                  <Badge variant="outline">{row.channel}</Badge>
                  {row.direction && <Badge variant="secondary">{row.direction}</Badge>}
                  {row.status && <Badge variant="outline">{row.status}</Badge>}
                </div>
                {row.summary && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">{row.summary}</p>}
                {(row.sender || row.recipient) && <p className="mt-1 break-words text-xs text-muted-foreground">
                  {row.sender ?? 'Unknown sender'} → {row.recipient ?? 'Unknown recipient'}
                </p>}
                {row.campaignId && <p className="mt-1 text-xs text-muted-foreground">Campaign {row.campaignId}</p>}
                <p className="mt-1 text-xs text-muted-foreground">Source: {row.source} · {row.sourceId}</p>
              </div>
              <time className="text-xs text-muted-foreground" dateTime={row.timestamp}>
                {new Date(row.timestamp).toLocaleString()}
              </time>
            </li>
          ))}
        </ol>}
        {!error && <div className="flex flex-wrap items-center gap-2">
          {entries.length > displayPage * PAGE_SIZE && <Button variant="outline" size="sm" onClick={() => setDisplayPage(p => p + 1)}>
            Show more activity
          </Button>}
          {hasMoreEmails && <Button variant="outline" size="sm" disabled={communications.isFetching}
            onClick={() => setEmailPage(p => p + 1)}>
            Load older email communications
          </Button>}
          {hasMoreInteractions && <Button variant="outline" size="sm" disabled={interactions.isFetching}
            onClick={() => setInteractionPage(p => p + 1)}>
            Load older interactions
          </Button>}
          <p className="text-xs text-muted-foreground">
            Showing {Math.min(entries.length, displayPage * PAGE_SIZE)} of {entries.length} loaded events
            {hasMoreInteractions || hasMoreEmails ? ' (older source events available)' : ''}
          </p>
        </div>}
      </CardContent>
    </Card>
  );
}
