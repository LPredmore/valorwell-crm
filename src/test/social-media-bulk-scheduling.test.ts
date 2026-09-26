import { describe, expect, it } from 'vitest';
import {
  allocatePreferredSlots, zonedDateTimeToIso,
  type BulkScheduleSource,
} from '../../supabase/functions/social-media-manager/handlers/bulk-scheduling';
import type { ContentFormat } from '../../supabase/functions/social-media-manager/types';

const preferred = {
  short: ['12:00', '15:00', '18:00'],
  longForm: ['08:00', '14:00'],
};

function item(index: number, contentFormat: ContentFormat = 'long_form') {
  return {
    sourceType: 'clip' as BulkScheduleSource['sourceType'],
    sourceId: `video-${index}`,
    contentFormat,
    title: `Video ${index}`,
  };
}

const weekdays = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'];
const now = Date.parse('2026-09-25T12:00:00.000Z');

describe('bulk social scheduling allocator', () => {
  it('spreads nine long-form videos across every first slot before using second slots', () => {
    const result = allocatePreferredSlots(
      Array.from({ length: 9 }, (_, index) => item(index + 1)),
      weekdays,
      preferred,
      new Set(),
      'America/Chicago',
      now,
    );

    expect(result.unassigned).toHaveLength(0);
    expect(result.assignments.map((assignment) => [assignment.localDate, assignment.localTime])).toEqual([
      ['2026-09-28', '08:00'],
      ['2026-09-29', '08:00'],
      ['2026-09-30', '08:00'],
      ['2026-10-01', '08:00'],
      ['2026-10-02', '08:00'],
      ['2026-09-28', '14:00'],
      ['2026-09-29', '14:00'],
      ['2026-09-30', '14:00'],
      ['2026-10-01', '14:00'],
    ]);
  });

  it('skips an occupied preferred slot without compressing everything onto one day', () => {
    const result = allocatePreferredSlots(
      Array.from({ length: 9 }, (_, index) => item(index + 1)),
      weekdays,
      preferred,
      new Set(['2026-09-29|08:00']),
      'America/Chicago',
      now,
    );

    expect(result.assignments.map((assignment) => [assignment.localDate, assignment.localTime])).toEqual([
      ['2026-09-28', '08:00'],
      ['2026-09-30', '08:00'],
      ['2026-10-01', '08:00'],
      ['2026-10-02', '08:00'],
      ['2026-09-28', '14:00'],
      ['2026-09-29', '14:00'],
      ['2026-09-30', '14:00'],
      ['2026-10-01', '14:00'],
      ['2026-10-02', '14:00'],
    ]);
  });

  it('uses noon across all selected days before the later Short slots', () => {
    const result = allocatePreferredSlots(
      Array.from({ length: 9 }, (_, index) => item(index + 1, 'short')),
      weekdays,
      preferred,
      new Set(),
      'America/Chicago',
      now,
    );

    expect(result.assignments.map((assignment) => [assignment.localDate, assignment.localTime])).toEqual([
      ['2026-09-28', '12:00'],
      ['2026-09-29', '12:00'],
      ['2026-09-30', '12:00'],
      ['2026-10-01', '12:00'],
      ['2026-10-02', '12:00'],
      ['2026-09-28', '15:00'],
      ['2026-09-29', '15:00'],
      ['2026-09-30', '15:00'],
      ['2026-10-01', '15:00'],
    ]);
  });

  it('does not invent extra times when the selected dates lack capacity', () => {
    const result = allocatePreferredSlots(
      Array.from({ length: 11 }, (_, index) => item(index + 1)),
      weekdays,
      preferred,
      new Set(),
      'America/Chicago',
      now,
    );

    expect(result.assignments).toHaveLength(10);
    expect(result.unassigned.map((video) => video.title)).toEqual(['Video 11']);
    expect(result.availableSlotCount).toBe(10);
  });

  it('converts configured Central slots to the correct UTC instant in CST and CDT', () => {
    expect(zonedDateTimeToIso('2026-01-15', '08:00', 'America/Chicago')).toBe('2026-01-15T14:00:00.000Z');
    expect(zonedDateTimeToIso('2026-07-15', '08:00', 'America/Chicago')).toBe('2026-07-15T13:00:00.000Z');
  });
});
