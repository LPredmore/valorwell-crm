const TIMEZONE = 'America/Chicago';

const WALL_CLOCK = new Intl.DateTimeFormat('en-US', {
  timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});

/** Milliseconds America/Chicago is behind UTC at the given instant (5h in CDT, 6h in CST). */
function centralOffsetMs(instantMs: number): number {
  const parts = Object.fromEntries(WALL_CLOCK.formatToParts(new Date(instantMs)).map((part) => [part.type, part.value]));
  const asIfUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour === '24' ? '0' : parts.hour), Number(parts.minute), Number(parts.second),
  );
  return instantMs - asIfUtc;
}

/**
 * Converts a wall-clock America/Chicago date+time into a UTC ISO string, DST-aware. The
 * offset is re-evaluated at the candidate instant, because on transition days the offset
 * at the naive guess can differ from the offset at the real instant (e.g. 3:30 AM on the
 * spring-forward day is CDT, but the naive guess falls on the CST side). An ambiguous
 * fall-back time resolves to its first (CDT) occurrence.
 */
export function centralTimeToUtcIso(dateStr: string, timeStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const firstPass = guess + centralOffsetMs(guess);
  return new Date(guess + centralOffsetMs(firstPass)).toISOString();
}

/** Splits a UTC ISO string into the date/time inputs' values as displayed in America/Chicago. */
export function utcIsoToCentralParts(iso: string): { date: string; time: string } {
  const date = new Date(iso);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

const CENTRAL_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
});

/**
 * The America/Chicago calendar date (YYYY-MM-DD) of an instant. Calendar cells and event
 * grouping both use this key, so an event always lands on the same Central day its
 * displayed Central time belongs to -- never the UTC day (toISOString) or the viewer's
 * local day.
 */
export function centralDateKey(instant: string | number | Date): string {
  const parts = Object.fromEntries(CENTRAL_DATE.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function keyToUtcDate(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function utcDateToKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Adds whole calendar days to a date key (pure date arithmetic; no time zone involved). */
export function addDaysToKey(key: string, days: number): string {
  const date = keyToUtcDate(key);
  date.setUTCDate(date.getUTCDate() + days);
  return utcDateToKey(date);
}

/** Adds calendar months to a date key, clamping to the 1st so short months never overflow. */
export function addMonthsToKey(key: string, months: number): string {
  const date = keyToUtcDate(key);
  return utcDateToKey(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1)));
}

/** Day of week (0 = Sunday) of a calendar date key. */
export function dayOfWeekForKey(key: string): number {
  return keyToUtcDate(key).getUTCDay();
}

/** Sunday-first grid of Central date keys: 7 days for a week view, 42 for a month view. */
export function calendarGridKeys(anchorKey: string, view: 'month' | 'week'): string[] {
  const start = view === 'week'
    ? addDaysToKey(anchorKey, -dayOfWeekForKey(anchorKey))
    : (() => {
      const monthStart = `${anchorKey.slice(0, 7)}-01`;
      return addDaysToKey(monthStart, -dayOfWeekForKey(monthStart));
    })();
  return Array.from({ length: view === 'week' ? 7 : 42 }, (_, index) => addDaysToKey(start, index));
}

/** "September 2026" for a date key, independent of the viewer's time zone. */
export function monthLabelForKey(key: string): string {
  return keyToUtcDate(key).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** "11:00 PM" in Central Time. */
export function formatCentralTime(instant: string | number | Date): string {
  return new Date(instant).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TIMEZONE });
}

/** "Thu, Sep 24, 11:00 PM CDT" in Central Time. */
export function formatCentralDateTime(instant: string | number | Date): string {
  return new Date(instant).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: TIMEZONE, timeZoneName: 'short',
  });
}
