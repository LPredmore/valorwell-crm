import { describe, expect, it } from 'vitest';
import {
  COMMAND_CENTER_CATEGORIES,
  COMMAND_CENTER_CATEGORY_LABELS,
  COMMAND_CENTER_STATUS_LABELS,
  categoryForModule,
  incompleteModules,
  isFindingRecurring,
  severityRank,
  sortFindingsForTriage,
  type CommandCenterOverview,
} from '@/lib/crm/command-center';
import { AI_OPERATIONS_MODULES } from '@/lib/crm/ai-operations';

describe('Command Center categories', () => {
  it('labels every management category', () => {
    for (const category of COMMAND_CENTER_CATEGORIES) {
      expect(COMMAND_CENTER_CATEGORY_LABELS[category]).toBeTruthy();
    }
  });

  it('maps every existing AI Operations module into a known category', () => {
    for (const module of AI_OPERATIONS_MODULES) {
      expect(COMMAND_CENTER_CATEGORIES).toContain(categoryForModule(module));
    }
  });

  it('maps operational modules to their management area', () => {
    expect(categoryForModule('client_journey')).toBe('client_care');
    expect(categoryForModule('billing_claims')).toBe('billing');
    expect(categoryForModule('content_performance')).toBe('marketing_content');
    expect(categoryForModule('sop_compliance')).toBe('compliance_sop');
    expect(categoryForModule('user_flow_smoke')).toBe('system_health');
  });
});

describe('Command Center prioritisation', () => {
  it('ranks severity deterministically', () => {
    expect(severityRank('critical')).toBeLessThan(severityRank('high'));
    expect(severityRank('high')).toBeLessThan(severityRank('medium'));
    expect(severityRank('medium')).toBeLessThan(severityRank('low'));
    expect(severityRank('unknown')).toBeGreaterThan(severityRank('low'));
  });

  it('sorts critical first then most recently seen', () => {
    const sorted = sortFindingsForTriage([
      { severity: 'medium', lastSeenAt: '2026-08-16T10:00:00Z', id: 'm' },
      { severity: 'critical', lastSeenAt: '2026-08-15T10:00:00Z', id: 'c1' },
      { severity: 'critical', lastSeenAt: '2026-08-16T10:00:00Z', id: 'c2' },
    ]);
    expect(sorted.map((item) => item.id)).toEqual(['c2', 'c1', 'm']);
  });
});

describe('Command Center lifecycle and degradation', () => {
  it('exposes the full lifecycle vocabulary', () => {
    expect(Object.keys(COMMAND_CENTER_STATUS_LABELS)).toEqual([
      'open', 'reviewed', 'assigned', 'in_progress', 'snoozed', 'resolved', 'dismissed',
    ]);
  });

  it('flags recurring findings by occurrence or reopen history', () => {
    expect(isFindingRecurring({ occurrenceCount: 3, reopenCount: 0 })).toBe(true);
    expect(isFindingRecurring({ occurrenceCount: 1, reopenCount: 2 })).toBe(true);
    expect(isFindingRecurring({ occurrenceCount: 2, reopenCount: 0 })).toBe(false);
  });

  it('reports only modules that did not succeed, and degrades when nothing has run', () => {
    const overview = {
      modules: [
        { module: 'communications', status: 'failed', completedAt: null, errorSummary: 'timeout' },
        { module: 'client_journey', status: 'success', completedAt: null, errorSummary: null },
      ],
    } as unknown as CommandCenterOverview;
    expect(incompleteModules(overview).map((entry) => entry.module)).toEqual(['communications']);
    expect(incompleteModules(null)).toEqual([]);
  });
});
