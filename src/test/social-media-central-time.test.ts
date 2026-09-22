import { describe, expect, it } from 'vitest';
import { centralTimeToUtcIso, utcIsoToCentralParts } from '@/components/crm/social-media/centralTime';

describe('social media Central Time conversion', () => {
  it('converts a Central Standard Time wall-clock date+time to the correct UTC instant', () => {
    // Jan 15 is outside DST -- America/Chicago is UTC-6.
    const iso = centralTimeToUtcIso('2026-01-15', '09:00');
    expect(iso).toBe('2026-01-15T15:00:00.000Z');
  });

  it('converts a Central Daylight Time wall-clock date+time to the correct UTC instant', () => {
    // Jul 15 is inside DST -- America/Chicago is UTC-5.
    const iso = centralTimeToUtcIso('2026-07-15', '09:00');
    expect(iso).toBe('2026-07-15T14:00:00.000Z');
  });

  it('round-trips back to the same Central Time date/time parts', () => {
    const iso = centralTimeToUtcIso('2026-03-10', '14:30');
    expect(utcIsoToCentralParts(iso)).toEqual({ date: '2026-03-10', time: '14:30' });
  });
});
