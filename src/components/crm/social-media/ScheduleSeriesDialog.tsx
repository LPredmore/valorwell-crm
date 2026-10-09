import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/hooks/use-toast';
import {
  assignSeriesSchedule, changeSeriesSchedule, fetchSeriesSchedules, removeSeriesSchedule,
  SERIES_STATUS_LABELS, type SeriesSchedule, type SeriesScheduleList,
} from '@/lib/crm/social-media';
import { addDaysToKey, formatCentralDateTime } from './centralTime';
import { SocialMediaErrorState } from './SocialMediaErrorState';

const PAGE_WEEKS = 8;

function weekRange(weekStart: string) {
  const fmt = (key: string, year = false) => {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC',
    });
  };
  return `${fmt(weekStart)} – ${fmt(addDaysToKey(weekStart, 6), true)}`;
}

function statusVariant(status: SeriesSchedule['status']): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'failed') return 'destructive';
  if (status === 'blocked' || status === 'partially_scheduled') return 'outline';
  if (status === 'youtube_scheduled' || status === 'complete') return 'default';
  return 'secondary';
}

function projectLabel(project: { organizationName: string | null; guestName: string | null }) {
  return project.guestName ? `${project.organizationName ?? 'Untitled'} — ${project.guestName}` : (project.organizationName ?? 'Untitled');
}

function WeekRow({ week, data, canMutate }: {
  week: SeriesScheduleList['weeks'][number]; data: SeriesScheduleList; canMutate: boolean;
}) {
  const queryClient = useQueryClient();
  const requestKey = useRef(crypto.randomUUID());
  const [expanded, setExpanded] = useState(false);
  const schedule = week.schedule;
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['social-media', 'series'] });
  const onError = (error: unknown) => toast({
    title: 'Could not save this week', description: error instanceof Error ? error.message : String(error), variant: 'destructive',
  });

  const assign = useMutation({
    mutationFn: (projectId: string) => schedule
      ? changeSeriesSchedule(schedule.id, projectId)
      : assignSeriesSchedule(week.weekStart, projectId, requestKey.current),
    onSuccess: () => { requestKey.current = crypto.randomUUID(); toast({ title: 'Week saved' }); invalidate(); },
    onError,
  });
  const remove = useMutation({
    mutationFn: () => removeSeriesSchedule(String(schedule?.id)),
    onSuccess: () => { toast({ title: 'Week cleared' }); invalidate(); },
    onError,
  });
  const busy = assign.isPending || remove.isPending;
  const cutoffPassed = week.cutoffPassed;
  const editable = canMutate && !cutoffPassed && (!schedule || schedule.editable);
  const options = schedule
    ? [{ id: schedule.projectId, organizationName: schedule.organizationName ?? 'Current project', guestName: schedule.guestName }, ...data.eligibleProjects]
    : data.eligibleProjects;
  const isCurrent = week.weekStart === data.currentWeekStart;

  return (
    <li className="rounded-md border p-3 space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="font-medium">
            {weekRange(week.weekStart)} {isCurrent && <span className="text-xs text-muted-foreground">(this week)</span>}
          </div>
          <div className="text-xs text-muted-foreground">
            {cutoffPassed ? 'Cutoff was' : 'Cutoff & dispatch'} {formatCentralDateTime(week.dispatchAt)}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {cutoffPassed && <Badge variant="outline">Cutoff passed</Badge>}
          {schedule && <Badge variant={statusVariant(schedule.status)}>{SERIES_STATUS_LABELS[schedule.status]}</Badge>}
          {editable ? (
            <Select value={schedule?.projectId ?? ''} onValueChange={(value) => assign.mutate(value)} disabled={busy}>
              <SelectTrigger className="w-full sm:w-72" aria-label={`Project for week of ${weekRange(week.weekStart)}`}>
                <SelectValue placeholder={options.length ? 'Choose a project' : 'No unassigned projects'} />
              </SelectTrigger>
              <SelectContent>
                {options.map((project) => (
                  <SelectItem key={project.id} value={project.id}>{projectLabel(project)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : schedule ? (
            <span className="text-sm">{projectLabel(schedule)}</span>
          ) : (
            <span className="text-sm text-muted-foreground">{cutoffPassed ? 'Unassigned (locked)' : 'Unassigned'}</span>
          )}
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-label="Saving" />}
          {schedule && editable && (
            <Button size="icon" variant="ghost" onClick={() => remove.mutate()} disabled={busy} aria-label="Remove project from this week">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
      {schedule && (schedule.lastError || schedule.blockedReasons.length > 0) && (
        <div className={`text-xs ${schedule.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`} role="status">
          {schedule.blockedReasons.length ? schedule.blockedReasons.join(' ') : schedule.lastError}
          {schedule.unrecoverable && ' Needs operator attention.'}
        </div>
      )}
      {schedule?.items && schedule.items.length > 0 && (
        <div>
          <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
            {expanded ? 'Hide' : 'Show'} {schedule.items.length} videos
          </Button>
          {expanded && (
            <ul className="mt-2 space-y-1 text-xs">
              {schedule.items.map((item) => (
                <li key={item.id} className="flex flex-wrap justify-between gap-2 border-b py-1 last:border-0">
                  <span className="min-w-0 truncate">
                    {item.contentFormat === 'full_episode' ? 'Full episode' : item.partNumber ? `Part ${item.partNumber}` : 'Short'}: {item.title ?? '—'}
                  </span>
                  <span className="text-muted-foreground">
                    {item.scheduledFor ? formatCentralDateTime(item.scheduledFor) : ''} · {item.status.replace(/_/g, ' ')}
                    {item.status === 'queued' && ' (internal, awaiting YouTube)'}
                    {item.lastError && <span className="text-destructive"> · {item.lastError}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

export function ScheduleSeriesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [offset, setOffset] = useState(0);
  const base = useQuery({
    queryKey: ['social-media', 'series', 'base'],
    queryFn: () => fetchSeriesSchedules(null, 1),
    enabled: open,
  });
  const fromWeek = useMemo(
    () => (base.data ? addDaysToKey(base.data.startWeekStart, offset * 7) : null),
    [base.data, offset],
  );
  const list = useQuery({
    queryKey: ['social-media', 'series', fromWeek],
    queryFn: () => fetchSeriesSchedules(fromWeek, PAGE_WEEKS),
    enabled: open && Boolean(fromWeek),
    refetchInterval: open ? 60_000 : false,
    retry: 1,
  });
  const error = base.error ?? list.error;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Schedule Series</DialogTitle>
          <DialogDescription>
            Assign one Beyond The Yellow project per Monday–Sunday week (Central time). At 4:00 PM Central on the
            Friday before, every current Part, Short and the full episode are scheduled across that week automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={() => setOffset((v) => Math.max(0, v - PAGE_WEEKS))} disabled={offset === 0}>
            <ChevronLeft className="h-4 w-4" /> Earlier
          </Button>
          <Button variant="outline" size="sm" onClick={() => setOffset((v) => v + PAGE_WEEKS)}>
            Later <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        {error ? (
          <div className="space-y-2">
            <SocialMediaErrorState error={error} />
            <Button size="sm" variant="outline" onClick={() => { base.refetch(); list.refetch(); }}>Retry</Button>
          </div>
        ) : !list.data ? (
          <div className="space-y-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
        ) : (
          <>
            {!list.data.canMutate && (
              <p className="text-sm text-muted-foreground">You can view the series schedule but not change it.</p>
            )}
            {list.data.eligibleProjects.length === 0 && list.data.canMutate && (
              <p className="text-sm text-muted-foreground">Every organization project is already assigned to a week.</p>
            )}
            <ul className="space-y-2">
              {list.data.weeks.map((week) => (
                <WeekRow key={week.weekStart} week={week} data={list.data} canMutate={list.data.canMutate} />
              ))}
            </ul>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
