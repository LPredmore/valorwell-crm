import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, CalendarDays, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import {
  bulkScheduleSocialPublications, CONTENT_FORMAT_LABELS, previewBulkSocialSchedule,
  type BulkScheduleSource, type SocialMediaLibraryItem,
} from '@/lib/crm/social-media';
import { addDaysToKey, centralDateKey, dayOfWeekForKey } from './centralTime';
import { SocialMediaErrorState } from './SocialMediaErrorState';

function startOfMondayWeek(key: string): string {
  const day = dayOfWeekForKey(key);
  return addDaysToKey(key, day === 0 ? -6 : 1 - day);
}

function keyDate(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function shortDayLabel(key: string): string {
  return keyDate(key).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function weekLabel(keys: string[]): string {
  if (!keys.length) return '';
  const start = keyDate(keys[0]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const end = keyDate(keys[keys.length - 1]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  return `${start} – ${end}`;
}

function displayTime(time: string): string {
  const [hour, minute] = time.split(':').map(Number);
  return new Date(Date.UTC(2000, 0, 1, hour, minute)).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: minute === 0 ? undefined : '2-digit',
    timeZone: 'UTC',
  });
}

function source(item: SocialMediaLibraryItem): BulkScheduleSource {
  return { sourceType: item.sourceType, sourceId: item.sourceId };
}

export function BulkScheduleDialog({
  open,
  onOpenChange,
  items,
  onScheduled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: SocialMediaLibraryItem[];
  onScheduled: () => void;
}) {
  const queryClient = useQueryClient();
  const today = centralDateKey(Date.now());
  const [anchorKey, setAnchorKey] = useState(() => startOfMondayWeek(today));
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [orderedItems, setOrderedItems] = useState<SocialMediaLibraryItem[]>(items);
  const itemSignature = items.map((item) => `${item.sourceType}:${item.sourceId}`).join('|');

  useEffect(() => {
    if (!open) return;
    setOrderedItems(items);
    setAnchorKey(startOfMondayWeek(today));
    setSelectedDates([]);
    // itemSignature intentionally represents the selection identity without resetting order
    // for unrelated query-cache object replacements while the dialog is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, itemSignature]);

  const weekKeys = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDaysToKey(anchorKey, index)),
    [anchorKey],
  );
  const sortedDates = useMemo(() => [...selectedDates].sort(), [selectedDates]);
  const sources = useMemo(() => orderedItems.map(source), [orderedItems]);

  const preview = useQuery({
    queryKey: ['social-media', 'bulk-schedule-preview', sources, sortedDates],
    queryFn: () => previewBulkSocialSchedule(sources, sortedDates),
    enabled: open && sources.length > 0 && sortedDates.length > 0,
    retry: false,
  });

  const scheduleMutation = useMutation({
    mutationFn: () => bulkScheduleSocialPublications(sources, sortedDates),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['social-media', 'library'] }),
        queryClient.invalidateQueries({ queryKey: ['social-media', 'publications'] }),
      ]);
      toast({
        title: `Scheduled ${result.scheduled.length} video${result.scheduled.length === 1 ? '' : 's'}`,
        description: 'Each video was queued through the normal YouTube publishing workflow.',
      });
      onScheduled();
      onOpenChange(false);
    },
    onError: (error: Error) => toast({ title: 'Bulk scheduling failed', description: error.message, variant: 'destructive' }),
  });

  const toggleDate = (key: string) => {
    if (key < today) return;
    setSelectedDates((current) => current.includes(key) ? current.filter((date) => date !== key) : [...current, key]);
  };

  const selectDisplayed = (weekdaysOnly: boolean) => {
    const eligible = weekKeys.filter((key, index) => key >= today && (!weekdaysOnly || index < 5));
    setSelectedDates((current) => [...new Set([...current, ...eligible])]);
  };

  const moveItem = (index: number, delta: number) => {
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= orderedItems.length) return;
    setOrderedItems((current) => {
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  const assignments = useMemo(
    () => [...(preview.data?.assignments ?? [])].sort((a, b) =>
      a.localDate.localeCompare(b.localDate) || a.localTime.localeCompare(b.localTime)),
    [preview.data],
  );
  const capacityBlocked = Boolean(preview.data?.unassigned.length);
  const canSchedule = Boolean(preview.data) && !capacityBlocked && !scheduleMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!scheduleMutation.isPending) onOpenChange(next); }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk schedule videos</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Pick calendar days, review the automatically distributed preferred slots, then schedule the whole batch.
          </p>
        </DialogHeader>

        <div className="space-y-5">
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Video order</h3>
              <span className="text-xs text-muted-foreground">{orderedItems.length} selected</span>
            </div>
            <div className="rounded-md border divide-y">
              {orderedItems.map((item, index) => (
                <div key={`${item.sourceType}:${item.sourceId}`} className="flex items-center gap-2 p-2">
                  <span className="w-6 text-center text-xs text-muted-foreground">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.title ?? '(untitled)'}</p>
                    <Badge variant="secondary" className="mt-1">{CONTENT_FORMAT_LABELS[item.contentFormat]}</Badge>
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    disabled={index === 0}
                    aria-label={`Move ${item.title ?? 'video'} up`}
                    onClick={() => moveItem(index, -1)}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    disabled={index === orderedItems.length - 1}
                    aria-label={`Move ${item.title ?? 'video'} down`}
                    onClick={() => moveItem(index, 1)}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4" />
                <h3 className="text-sm font-semibold">Choose days</h3>
                <span className="text-xs text-muted-foreground">{weekLabel(weekKeys)}</span>
              </div>
              <div className="flex items-center gap-1">
                <Button type="button" size="icon" variant="outline" aria-label="Previous week" onClick={() => setAnchorKey((key) => addDaysToKey(key, -7))}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setAnchorKey(startOfMondayWeek(today))}>This week</Button>
                <Button type="button" size="icon" variant="outline" aria-label="Next week" onClick={() => setAnchorKey((key) => addDaysToKey(key, 7))}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              {weekKeys.map((key) => {
                const selected = selectedDates.includes(key);
                const past = key < today;
                return (
                  <Button
                    key={key}
                    type="button"
                    variant={selected ? 'default' : 'outline'}
                    className="h-auto min-h-14 flex-col py-2"
                    disabled={past}
                    aria-pressed={selected}
                    onClick={() => toggleDate(key)}
                  >
                    <span className="text-xs">{shortDayLabel(key).split(',')[0]}</span>
                    <span className="text-xs font-normal">{shortDayLabel(key).split(',').slice(1).join(',').trim()}</span>
                  </Button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" variant="secondary" onClick={() => selectDisplayed(true)}>Add weekdays</Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => selectDisplayed(false)}>Add full week</Button>
              <Button type="button" size="sm" variant="ghost" disabled={!selectedDates.length} onClick={() => setSelectedDates([])}>Clear days</Button>
              <span className="text-xs text-muted-foreground">{selectedDates.length} day{selectedDates.length === 1 ? '' : 's'} selected</span>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Schedule preview</h3>
            {!sortedDates.length && (
              <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Select at least one day to preview the schedule.</p>
            )}
            {preview.isFetching && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Calculating available preferred slots…</div>
            )}
            {preview.error && <SocialMediaErrorState error={preview.error} />}
            {preview.data && !preview.isFetching && (
              <>
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge variant="outline">Shorts: {preview.data.preferredScheduleTimes.short.map(displayTime).join(', ')}</Badge>
                  <Badge variant="outline">Long form: {preview.data.preferredScheduleTimes.longForm.map(displayTime).join(', ')}</Badge>
                  <Badge variant="secondary">{preview.data.timezone}</Badge>
                </div>
                <p className="text-sm">
                  <span className="font-medium">{preview.data.selectedCount} selected</span>
                  {' · '}
                  {preview.data.availableSlotCount} available preferred slot{preview.data.availableSlotCount === 1 ? '' : 's'} across the selected days
                </p>
                {capacityBlocked && (
                  <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">
                    {preview.data.unassigned.length} video{preview.data.unassigned.length === 1 ? '' : 's'} do not fit in the selected preferred slots. Select more days before scheduling.
                  </div>
                )}
                <div className="rounded-md border divide-y">
                  {assignments.map((assignment) => (
                    <div key={`${assignment.sourceType}:${assignment.sourceId}`} className="grid gap-1 p-2 sm:grid-cols-[9rem_6rem_1fr_auto] sm:items-center">
                      <span className="text-xs text-muted-foreground">{shortDayLabel(assignment.localDate)}</span>
                      <span className="text-sm font-medium">{displayTime(assignment.localTime)}</span>
                      <span className="min-w-0 truncate text-sm">{assignment.title}</span>
                      <Badge variant="secondary">{CONTENT_FORMAT_LABELS[assignment.contentFormat]}</Badge>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={scheduleMutation.isPending} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" disabled={!canSchedule} onClick={() => scheduleMutation.mutate()}>
            {scheduleMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Schedule {orderedItems.length} video{orderedItems.length === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
