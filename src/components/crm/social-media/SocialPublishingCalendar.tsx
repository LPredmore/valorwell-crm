import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { fetchSocialPublications, STATUS_LABELS, type SocialPublication } from '@/lib/crm/social-media';
import { SocialPublicationEditor } from './SocialPublicationEditor';
import { SocialMediaErrorState } from './SocialMediaErrorState';

function startOfWeek(date: Date): Date {
  const result = new Date(date);
  result.setDate(result.getDate() - result.getDay());
  result.setHours(0, 0, 0, 0);
  return result;
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function SocialPublishingCalendar() {
  const [view, setView] = useState<'month' | 'week'>('month');
  const [anchor, setAnchor] = useState(new Date());
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, error } = useQuery({
    queryKey: ['social-media', 'publications', { scheduledOnly: true }],
    queryFn: () => fetchSocialPublications({ scheduledOnly: true }),
    retry: 1,
  });

  const byDay = useMemo(() => {
    const map = new Map<string, SocialPublication[]>();
    for (const pub of data ?? []) {
      if (!pub.scheduledFor) continue;
      const key = dayKey(new Date(pub.scheduledFor));
      map.set(key, [...(map.get(key) ?? []), pub]);
    }
    return map;
  }, [data]);

  const days = useMemo(() => {
    if (view === 'week') {
      const start = startOfWeek(anchor);
      return Array.from({ length: 7 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
    }
    const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const gridStart = startOfWeek(monthStart);
    return Array.from({ length: 42 }, (_, index) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index));
  }, [anchor, view]);

  const shift = (delta: number) => {
    const next = new Date(anchor);
    if (view === 'week') next.setDate(next.getDate() + delta * 7);
    else next.setMonth(next.getMonth() + delta);
    setAnchor(next);
  };

  return (
    <div className="pt-4 space-y-3">
      {error && <SocialMediaErrorState error={error} />}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button size="icon" variant="outline" onClick={() => shift(-1)}><ChevronLeft className="h-4 w-4" /></Button>
          <span className="text-sm font-medium min-w-40 text-center">
            {anchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </span>
          <Button size="icon" variant="outline" onClick={() => shift(1)}><ChevronRight className="h-4 w-4" /></Button>
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
        {days.map((day) => {
          const events = byDay.get(dayKey(day)) ?? [];
          const inMonth = view === 'week' || day.getMonth() === anchor.getMonth();
          return (
            <div key={day.toISOString()} className={`bg-background min-h-24 p-1 space-y-1 ${inMonth ? '' : 'opacity-40'}`}>
              <div className="text-xs text-muted-foreground">{day.getDate()}</div>
              {events.map((event) => (
                <button
                  key={event.id}
                  className="w-full text-left text-xs rounded bg-primary/10 hover:bg-primary/20 px-1 py-0.5 truncate"
                  onClick={() => setOpenId(event.id)}
                >
                  {new Date(event.scheduledFor as string).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' })}
                  {' '}{event.title ?? '(untitled)'}
                </button>
              ))}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline">{STATUS_LABELS.scheduled}</Badge>
        <span>Times shown in Central Time.</span>
      </div>

      {openId && (
        <SocialPublicationEditor open={Boolean(openId)} onOpenChange={(open) => { if (!open) setOpenId(null); }} publicationId={openId} />
      )}
    </div>
  );
}
