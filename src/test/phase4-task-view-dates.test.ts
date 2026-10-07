import { describe, expect, it } from 'vitest';
import { buildCanonicalTaskListQuery } from '@/hooks/canonical/useCrmData';
import {
  buildTaskViewDateBounds,
  CRM_TASK_WEEK_START,
} from '@/lib/crm/taskViewDates';

describe('Phase 4 task view date boundaries', () => {
  it('builds the operator-local Central day and Sunday-first week as UTC instants', () => {
    const bounds = buildTaskViewDateBounds(
      new Date('2026-10-07T02:00:00.000Z'), // Tue Oct 6, 9:00 PM CDT
      'America/Chicago',
    );

    expect(CRM_TASK_WEEK_START).toBe(0);
    expect(bounds).toEqual({
      timeZone: 'America/Chicago',
      dayStartIso: '2026-10-06T05:00:00.000Z',
      nextDayStartIso: '2026-10-07T05:00:00.000Z',
      weekStartIso: '2026-10-04T05:00:00.000Z',
      nextWeekStartIso: '2026-10-11T05:00:00.000Z',
    });
  });

  it('keeps local calendar boundaries correct across spring-forward DST', () => {
    const bounds = buildTaskViewDateBounds(
      new Date('2026-03-08T18:00:00.000Z'),
      'America/Chicago',
    );

    expect(bounds.dayStartIso).toBe('2026-03-08T06:00:00.000Z');
    expect(bounds.nextDayStartIso).toBe('2026-03-09T05:00:00.000Z');
    expect(
      new Date(bounds.nextDayStartIso).getTime() - new Date(bounds.dayStartIso).getTime(),
    ).toBe(23 * 60 * 60 * 1000);
    expect(bounds.weekStartIso).toBe('2026-03-08T06:00:00.000Z');
    expect(bounds.nextWeekStartIso).toBe('2026-03-15T05:00:00.000Z');
  });

  it('keeps local calendar boundaries correct across fall-back DST', () => {
    const bounds = buildTaskViewDateBounds(
      new Date('2026-11-01T18:00:00.000Z'),
      'America/Chicago',
    );

    expect(bounds.dayStartIso).toBe('2026-11-01T05:00:00.000Z');
    expect(bounds.nextDayStartIso).toBe('2026-11-02T06:00:00.000Z');
    expect(
      new Date(bounds.nextDayStartIso).getTime() - new Date(bounds.dayStartIso).getTime(),
    ).toBe(25 * 60 * 60 * 1000);
  });

  it('injects the authenticated tenant/profile and only adds date bounds to calendar views', () => {
    const calendarQuery = buildCanonicalTaskListQuery(
      { view: 'due-today' },
      {
        tenantId: 'tenant-a',
        profileId: 'profile-me',
        now: new Date('2026-10-07T02:00:00.000Z'),
        timeZone: 'America/Chicago',
      },
    );

    expect(calendarQuery).toMatchObject({
      view: 'due-today',
      tenantId: 'tenant-a',
      currentProfileId: 'profile-me',
      dateBounds: {
        dayStartIso: '2026-10-06T05:00:00.000Z',
        nextDayStartIso: '2026-10-07T05:00:00.000Z',
      },
    });

    expect(buildCanonicalTaskListQuery(
      { view: 'my' },
      { tenantId: 'tenant-a', profileId: 'profile-me' },
    )).toEqual({
      view: 'my',
      tenantId: 'tenant-a',
      currentProfileId: 'profile-me',
    });

    expect(buildCanonicalTaskListQuery(
      { view: 'all' },
      { tenantId: null, profileId: 'profile-me' },
    )).toBeNull();
  });
});
