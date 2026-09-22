const TIMEZONE = 'America/Chicago';

/** Converts a wall-clock America/Chicago date+time into a UTC ISO string, DST-aware. */
export function centralTimeToUtcIso(dateStr: string, timeStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(guess).map((part) => [part.type, part.value]));
  const asIfUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour === '24' ? '0' : parts.hour), Number(parts.minute), Number(parts.second),
  );
  const offset = guess.getTime() - asIfUtc;
  return new Date(guess.getTime() + offset).toISOString();
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
