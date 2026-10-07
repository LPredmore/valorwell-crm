import type { TaskViewDateBounds } from '@/domain/taskViews';

export const CRM_TASK_WEEK_START = 0; // Sunday, matching the existing CRM calendar convention.
export const CRM_TASK_TIMEZONE_FALLBACK = 'America/Chicago';

const DATE_KEY_FORMATTERS = new Map<string, Intl.DateTimeFormat>();
const WALL_CLOCK_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function dateKeyFormatter(timeZone: string): Intl.DateTimeFormat {
  const existing = DATE_KEY_FORMATTERS.get(timeZone);
  if (existing) return existing;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  DATE_KEY_FORMATTERS.set(timeZone, formatter);
  return formatter;
}

function wallClockFormatter(timeZone: string): Intl.DateTimeFormat {
  const existing = WALL_CLOCK_FORMATTERS.get(timeZone);
  if (existing) return existing;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  WALL_CLOCK_FORMATTERS.set(timeZone, formatter);
  return formatter;
}

function zonedDateKey(instant: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    dateKeyFormatter(timeZone).formatToParts(instant).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function keyToUtcDate(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function addDaysToKey(key: string, days: number): string {
  const date = keyToUtcDate(key);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dayOfWeekForKey(key: string): number {
  return keyToUtcDate(key).getUTCDay();
}

/**
 * Milliseconds the named zone is behind UTC at an instant.
 * Positive values mean the local zone is behind UTC (e.g. America/Chicago).
 */
function zoneBehindUtcMs(timeZone: string, instantMs: number): number {
  const normalizedInstantMs = Math.trunc(instantMs / 1000) * 1000;
  const parts = Object.fromEntries(
    wallClockFormatter(timeZone)
      .formatToParts(new Date(normalizedInstantMs))
      .map((part) => [part.type, part.value]),
  );
  const localAsIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return normalizedInstantMs - localAsIfUtc;
}

/** Converts midnight in a named IANA time zone to its UTC instant, including DST transitions. */
function zonedMidnightToUtcIso(dateKey: string, timeZone: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const wallClockGuess = Date.UTC(year, month - 1, day, 0, 0, 0);
  let candidate = wallClockGuess + zoneBehindUtcMs(timeZone, wallClockGuess);
  // Re-evaluate at the candidate because the UTC guess can be on the other side of a DST transition.
  for (let pass = 0; pass < 2; pass += 1) {
    candidate = wallClockGuess + zoneBehindUtcMs(timeZone, candidate);
  }
  return new Date(candidate).toISOString();
}

export function resolveOperatorTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || CRM_TASK_TIMEZONE_FALLBACK;
  } catch {
    return CRM_TASK_TIMEZONE_FALLBACK;
  }
}

export function buildTaskViewDateBounds(
  now: Date,
  timeZone: string,
  weekStartsOn = CRM_TASK_WEEK_START,
): TaskViewDateBounds {
  if (!Number.isInteger(weekStartsOn) || weekStartsOn < 0 || weekStartsOn > 6) {
    throw new Error('weekStartsOn must be an integer from 0 (Sunday) through 6 (Saturday)');
  }

  const todayKey = zonedDateKey(now, timeZone);
  const todayDow = dayOfWeekForKey(todayKey);
  const daysSinceWeekStart = (todayDow - weekStartsOn + 7) % 7;
  const weekStartKey = addDaysToKey(todayKey, -daysSinceWeekStart);

  return {
    timeZone,
    dayStartIso: zonedMidnightToUtcIso(todayKey, timeZone),
    nextDayStartIso: zonedMidnightToUtcIso(addDaysToKey(todayKey, 1), timeZone),
    weekStartIso: zonedMidnightToUtcIso(weekStartKey, timeZone),
    nextWeekStartIso: zonedMidnightToUtcIso(addDaysToKey(weekStartKey, 7), timeZone),
  };
}
