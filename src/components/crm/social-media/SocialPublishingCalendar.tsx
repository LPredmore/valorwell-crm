import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  CONTENT_FORMAT_LABELS, fetchSocialPublications, publicationPollInterval, STATUS_LABELS,
  type PublicationStatus,
} from '@/lib/crm/social-media';
import { SocialPublicationEditor } from './SocialPublicationEditor';
import { SocialMediaErrorState } from './SocialMediaErrorState';
import {
  addDaysToKey, addMonthsToKey, calendarGridKeys, centralDateKey, formatCentralTime, monthLabelForKey,
} from './centralTime';
import { groupByCentralDay } from './publicationViews';

const STATUS_TONE: Partial<Record<PublicationStatus, string>> = {
  scheduled: 'bg-sky-100 text-sky-900 hover:bg-sky-200 dark:bg-sky-950 dark:text-sky-100',
  published: 'bg-emerald-100 text-emerald-900 hover:bg-emerald-200 dark:bg-emerald-950 dark:text-emerald-100',
  failed: 'bg-destructive/15 text-destructive hover:bg-destructive/25',
  cancelled: 'bg-muted text-muted-foreground line-through',
};
const DEFAULT_TONE = 'bg-primary/10 hover:bg-primary/20';

export function SocialPublishingCalendar() {
  const [view, setView] = useState<'month' | 'week'>('month');
  // The calendar navigates in Central calendar days, whatever the viewer's own time zone.
  const [anchorKey, setAnchorKey] = useState(() => centralDateKey(Date.now()));
  const [openId, setOpenId] = useState<string | null>(null);
  const todayKey = centralDateKey(Date.now());

  const { data, error } = useQuery({
    queryKey: ['social-media', 'publications', { scheduledOnly: true }],
    queryFn: () => fetchSocialPublications({ scheduledOnly: true }),
    retry: 1,
    refetchInterval: (query) => (query.state.error ? false : publicationPollInterval(query.state.data)),
  });

  const byDay = useMemo(() => groupByCentralDay(data), [data]);
  const days = useMemo(() => calendarGridKeys(anchorKey, view), [anchorKey, view]);

  const shift = (delta: number) => setAnchorKey((key) => (view === 'week' ? addDaysToKey(key, delta * 7) : addMonthsToKey(key, delta)));

  return (
    <div className="pt-4 space-y-3">
      {error && <SocialMediaErrorState error={error} />}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button size="icon" variant="outline" aria-label="Previous" onClick={() => shift(-1)}><ChevronLeft className="h-4 w-4" /></Button>
          <span className="text-sm font-medium min-w-40 text-center">{monthLabelForKey(anchorKey)}</span>
          <Button size="icon" variant="outline" aria-label="Next" onClick={() => shift(1)}><ChevronRight className="h-4 w-4" /></Button>
          <Button size="sm" variant="ghost" onClick={() => setAnchorKey(todayKey)}>Today</Button>
        </div>
        <Tabs value={view} onValueChange={(value) => setView(value as 'month' | 'week')}>
          <TabsList>
            <TabsTrigger value="month">Month</TabsTrigger>
            <TabsTrigger value="week">Week</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="grid grid-cols-7 gap-px bg-border rounded-md overflow-hidden">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label) => (
          <div key={label} className="bg-muted text-xs font-medium p-1 text-center">{label}</div>
        ))}
        {days.map((key) => {
          const events = byDay.get(key) ?? [];
          const inMonth = view === 'week' || key.slice(0, 7) === anchorKey.slice(0, 7);
          return (
            <div key={key} data-day={key} className={`bg-background min-h-24 p-1 space-y-1 ${inMonth ? '' : 'opacity-40'}`}>
              <div className={`text-xs ${key === todayKey ? 'font-semibold text-primary' : 'text-muted-foreground'}`}>{Number(key.slice(8, 10))}</div>
              {events.map((event) => (
                <button
                  key={event.id}
                  type="button"
                  className={`w-full text-left text-xs rounded px-1 py-0.5 ${STATUS_TONE[event.status] ?? DEFAULT_TONE}`}
                  title={`${event.title ?? '(untitled)'} — ${STATUS_LABELS[event.status]}`}
                  onClick={() => setOpenId(event.id)}
                >
                  <span className="font-medium">{formatCentralTime(event.scheduledFor as string)}</span>
                  {' · '}{CONTENT_FORMAT_LABELS[event.contentFormat]}
                  <span className="block truncate">{event.title ?? '(untitled)'}</span>
                  <span className="block text-[10px] opacity-80">{STATUS_LABELS[event.status]}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">Days and times are shown in Central Time (America/Chicago).</p>

      {openId && (
        <SocialPublicationEditor open={Boolean(openId)} onOpenChange={(open) => { if (!open) setOpenId(null); }} publicationId={openId} />
      )}
    </div>
  );
}
