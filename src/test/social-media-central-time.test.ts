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

import {
  addDaysToKey, addMonthsToKey, calendarGridKeys, centralDateKey, dayOfWeekForKey, formatCentralTime, monthLabelForKey,
} from '@/components/crm/social-media/centralTime';
import { groupByCentralDay } from '@/components/crm/social-media/publicationViews';
import type { SocialPublication } from '@/lib/crm/social-media';

describe('social media calendar day placement (America/Chicago)', () => {
  it('places 11:00 PM Central (CDT) on its Central day, not the next UTC day', () => {
    const iso = centralTimeToUtcIso('2026-07-15', '23:00');
    expect(iso).toBe('2026-07-16T04:00:00.000Z');
    expect(iso.slice(0, 10)).toBe('2026-07-16'); // what toISOString grouping used to do
    expect(centralDateKey(iso)).toBe('2026-07-15');
    expect(formatCentralTime(iso)).toBe('11:00 PM');
  });

  it('places 11:00 PM Central (CST) on its Central day', () => {
    const iso = centralTimeToUtcIso('2026-01-15', '23:00');
    expect(iso).toBe('2026-01-16T05:00:00.000Z');
    expect(centralDateKey(iso)).toBe('2026-01-15');
  });

  it('handles the midnight boundary on both sides', () => {
    expect(centralDateKey(centralTimeToUtcIso('2026-07-16', '00:00'))).toBe('2026-07-16');
    expect(centralDateKey(centralTimeToUtcIso('2026-07-15', '23:59'))).toBe('2026-07-15');
    expect(centralDateKey('2026-07-16T04:59:59.000Z')).toBe('2026-07-15');
    expect(centralDateKey('2026-07-16T05:00:00.000Z')).toBe('2026-07-16');
  });

  it('keeps the right day and time across the spring-forward transition (2026-03-08)', () => {
    const before = centralTimeToUtcIso('2026-03-08', '01:30'); // CST, UTC-6
    const after = centralTimeToUtcIso('2026-03-08', '03:30'); // CDT, UTC-5
    const late = centralTimeToUtcIso('2026-03-08', '23:30');
    expect(before).toBe('2026-03-08T07:30:00.000Z');
    expect(after).toBe('2026-03-08T08:30:00.000Z');
    expect(late).toBe('2026-03-09T04:30:00.000Z');
    expect([before, after, late].map(centralDateKey)).toEqual(['2026-03-08', '2026-03-08', '2026-03-08']);
    expect(formatCentralTime(late)).toBe('11:30 PM');
  });

  it('keeps the right day and time across the fall-back transition (2026-11-01)', () => {
    const late = centralTimeToUtcIso('2026-11-01', '23:00'); // CST again, UTC-6
    expect(late).toBe('2026-11-02T05:00:00.000Z');
    expect(centralDateKey(late)).toBe('2026-11-01');
    expect(centralDateKey(centralTimeToUtcIso('2026-10-31', '23:00'))).toBe('2026-10-31');
  });

  it('groups events into the Central-day cell whose time they display, earliest first', () => {
    const pub = (id: string, scheduledFor: string) => ({ id, scheduledFor } as SocialPublication);
    const grouped = groupByCentralDay([
      pub('late', centralTimeToUtcIso('2026-07-15', '23:00')),
      pub('early', centralTimeToUtcIso('2026-07-15', '08:00')),
      pub('next', centralTimeToUtcIso('2026-07-16', '00:30')),
      { id: 'unscheduled', scheduledFor: null } as SocialPublication,
    ]);
    expect(grouped.get('2026-07-15')?.map((event) => event.id)).toEqual(['early', 'late']);
    expect(grouped.get('2026-07-16')?.map((event) => event.id)).toEqual(['next']);
    expect(grouped.has('2026-07-14')).toBe(false);
  });

  it('builds Sunday-first month and week grids from Central date keys', () => {
    const month = calendarGridKeys('2026-09-24', 'month');
    expect(month).toHaveLength(42);
    expect(month[0]).toBe('2026-08-30');
    expect(dayOfWeekForKey(month[0])).toBe(0);
    expect(month).toContain('2026-09-30');
    expect(calendarGridKeys('2026-09-24', 'week')).toEqual([
      '2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26',
    ]);
    // A week spanning the DST change still has seven consecutive days.
    expect(calendarGridKeys('2026-03-08', 'week')).toEqual([
      '2026-03-08', '2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13', '2026-03-14',
    ]);
  });

  it('navigates by calendar day and month without drifting', () => {
    expect(addDaysToKey('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDaysToKey('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDaysToKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(addMonthsToKey('2026-01-31', 1)).toBe('2026-02-01');
    expect(addMonthsToKey('2026-01-15', -1)).toBe('2025-12-01');
    expect(monthLabelForKey('2026-09-01')).toBe('September 2026');
  });
});

describe('Central Time conversion on DST transition days', () => {
  it('converts every hour of the spring-forward and fall-back days to the instant that displays back identically', () => {
    for (const date of ['2026-03-08', '2026-11-01', '2027-03-14']) {
      for (let hour = 0; hour < 24; hour += 1) {
        if (date !== '2026-11-01' && hour === 2) continue; // 2:xx AM does not exist on spring-forward days
        const time = `${String(hour).padStart(2, '0')}:30`;
        expect(utcIsoToCentralParts(centralTimeToUtcIso(date, time))).toEqual({ date, time });
      }
    }
  });

  it('resolves the repeated fall-back hour to its first (CDT) occurrence', () => {
    expect(centralTimeToUtcIso('2026-11-01', '01:30')).toBe('2026-11-01T06:30:00.000Z');
    expect(centralTimeToUtcIso('2026-11-01', '03:00')).toBe('2026-11-01T09:00:00.000Z');
  });
});
