import { describe, expect, it } from 'vitest';
import {
  AI_OPERATIONS_SNOOZE_PRESETS,
  buildAiOperationsWidgetSummary,
  resolveSnoozeUntil,
} from '@/lib/crm/ai-operations';

describe('AI Operations snooze presets', () => {
  const now = new Date('2026-08-17T15:00:00.000Z');

  it('offers the four standard windows', () => {
    expect(AI_OPERATIONS_SNOOZE_PRESETS.map((preset) => preset.key)).toEqual([
      'later_today',
      'tomorrow',
      'three_days',
      'one_week',
    ]);
  });

  it('resolves each preset to a future instant', () => {
    for (const preset of AI_OPERATIONS_SNOOZE_PRESETS) {
      const until = resolveSnoozeUntil(preset.key, now);
      expect(until?.getTime()).toBeGreaterThan(now.getTime());
    }
  });

  it('resolves one week to seven days out', () => {
    expect(resolveSnoozeUntil('one_week', now)?.toISOString()).toBe('2026-08-24T15:00:00.000Z');
  });

  it('returns null for an unknown preset', () => {
    expect(resolveSnoozeUntil('never', now)).toBeNull();
  });
});

describe('AI Operations widget summary', () => {
  it('degrades gracefully when no overview is available', () => {
    const summary = buildAiOperationsWidgetSummary(null);
    expect(summary.briefStatus).toBe('unavailable');
    expect(summary.openCount).toBe(0);
    expect(summary.modules).toHaveLength(4);
    expect(summary.modules.every((module) => module.status === 'unknown')).toBe(true);
  });

  it('summarises counts, brief state, and module status', () => {
    const summary = buildAiOperationsWidgetSummary({
      run: { businessDate: '2026-08-17' },
      brief: { status: 'published', generatedAt: '2026-08-17T09:35:00.000Z', isPartial: true },
      findingCounts: { critical: 2, high: 3, medium: 1 },
      modules: [
        { module: 'system_integrity', status: 'success' },
        { module: 'communications', status: 'failed' },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    expect(summary.businessDate).toBe('2026-08-17');
    expect(summary.briefIsPartial).toBe(true);
    expect(summary.criticalCount).toBe(2);
    expect(summary.highCount).toBe(3);
    expect(summary.openCount).toBe(6);
    expect(summary.modules.find((module) => module.module === 'communications')?.status).toBe('failed');
    expect(summary.modules.find((module) => module.module === 'youtube')?.status).toBe('unknown');
  });
});
