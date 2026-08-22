import { describe, expect, it } from 'vitest';
import {
  AI_OPERATIONS_AUTOMATIC_MODULES,
  AI_OPERATIONS_FLAGS,
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

describe('AI Operations monitoring controls', () => {
  it('uses monitoring-specific flags for deterministic Bucket 2 modules', () => {
    expect(AI_OPERATIONS_FLAGS).toContain('client_journey_monitoring_enabled');
    expect(AI_OPERATIONS_FLAGS).toContain('staff_workflow_monitoring_enabled');
    expect(AI_OPERATIONS_FLAGS).toContain('appointment_integrity_monitoring_enabled');
    expect(AI_OPERATIONS_FLAGS).toContain('billing_claims_monitoring_enabled');
    expect(AI_OPERATIONS_FLAGS).toContain('data_quality_monitoring_enabled');
    expect(AI_OPERATIONS_FLAGS).toContain('relationship_followup_monitoring_enabled');
    expect(AI_OPERATIONS_FLAGS).toContain('sop_compliance_monitoring_enabled');
    expect(AI_OPERATIONS_FLAGS).not.toContain('staff_quality_ai_enabled' as never);
    expect(AI_OPERATIONS_FLAGS).not.toContain('billing_claims_ai_enabled' as never);
  });
});

describe('AI Operations widget summary', () => {
  it('degrades gracefully when no overview is available', () => {
    const summary = buildAiOperationsWidgetSummary(null);
    expect(summary.briefStatus).toBe('unavailable');
    expect(summary.openCount).toBe(0);
    expect(summary.modules).toHaveLength(AI_OPERATIONS_AUTOMATIC_MODULES.length);
    expect(summary.modules.every((module) => module.status === 'unknown')).toBe(true);
  });

  it('summarises automatic counts without mixing in manual backlog', () => {
    const summary = buildAiOperationsWidgetSummary({
      run: { businessDate: '2026-08-17' },
      brief: { status: 'published', generatedAt: '2026-08-17T09:35:00.000Z', isPartial: true },
      findingCounts: { critical: 2, high: 3, medium: 9 },
      automaticFindingCounts: { critical: 2, high: 3 },
      automaticOpenCount: 5,
      manualOpenCount: 9,
      modules: [
        { module: 'system_integrity', status: 'success' },
        { module: 'client_journey', status: 'success' },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    expect(summary.businessDate).toBe('2026-08-17');
    expect(summary.briefIsPartial).toBe(true);
    expect(summary.criticalCount).toBe(2);
    expect(summary.highCount).toBe(3);
    expect(summary.openCount).toBe(5);
    expect(summary.modules.find((module) => module.module === 'system_integrity')?.status).toBe('success');
    expect(summary.modules.find((module) => module.module === 'billing_claims')?.status).toBe('unknown');
    expect(summary.modules.some((module) => module.module === 'communications')).toBe(false);
  });
});
