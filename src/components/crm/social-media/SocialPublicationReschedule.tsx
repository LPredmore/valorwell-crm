import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { SocialPublication } from '@/lib/crm/social-media';
import { centralTimeToUtcIso, formatCentralDateTime, utcIsoToCentralParts } from './centralTime';

/**
 * Reschedules an already-uploaded Scheduled video. The backend changes YouTube's publishAt
 * first and only records the new time once YouTube confirms it; nothing else is editable.
 */
export function SocialPublicationReschedule({
  publication,
  pending,
  onReschedule,
}: {
  publication: SocialPublication;
  pending: boolean;
  onReschedule: (scheduledFor: string) => void;
}) {
  const current = publication.scheduledFor ? utcIsoToCentralParts(publication.scheduledFor) : { date: '', time: '' };
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(current.date);
  const [time, setTime] = useState(current.time);
  const next = date && time ? centralTimeToUtcIso(date, time) : null;
  const unchanged = next !== null && publication.scheduledFor !== null && Date.parse(next) === Date.parse(publication.scheduledFor);
  const inPast = next !== null && Date.parse(next) < Date.now() + 60_000;

  if (!open) {
    return <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Reschedule</Button>;
  }

  return (
    <div className="space-y-2 rounded-md border p-3 text-sm">
      <h4 className="font-semibold">Reschedule on YouTube</h4>
      <p className="text-muted-foreground">
        Current: {publication.scheduledFor ? formatCentralDateTime(publication.scheduledFor) : '—'}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor="reschedule-date" className="sr-only">New date</Label>
        <Input id="reschedule-date" type="date" className="w-40" value={date} onChange={(event) => setDate(event.target.value)} />
        <Label htmlFor="reschedule-time" className="sr-only">New time</Label>
        <Input id="reschedule-time" type="time" className="w-32" value={time} onChange={(event) => setTime(event.target.value)} />
        <span className="text-xs text-muted-foreground">Central Time</span>
      </div>
      {next && !unchanged && (
        <p className="text-muted-foreground">New: {formatCentralDateTime(next)}</p>
      )}
      <p className="text-xs text-amber-700 dark:text-amber-400">
        This also changes the publish time on YouTube. The CRM only saves the new time after YouTube confirms it.
      </p>
      {inPast && <p className="text-xs text-destructive">Choose a time at least one minute in the future.</p>}
      <div className="flex gap-2">
        <Button size="sm" disabled={!next || unchanged || inPast || pending} onClick={() => next && onReschedule(next)}>
          {pending ? 'Updating YouTube…' : 'Confirm new time'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Close</Button>
      </div>
    </div>
  );
}
