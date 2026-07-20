import { describe, expect, it } from 'vitest';
import { capabilityState } from '@/domain/relationships/capabilities';
import { relationshipReportMetrics } from '@/services/relationships/reporting';

describe('relationship reporting', () => {
  it('uses unavailable values rather than fabricated zeroes while reporting is pending', () => {
    const metrics = relationshipReportMetrics({ capability: capabilityState('reporting') });
    expect(metrics).toHaveLength(11);
    expect(metrics.every((metric) => metric.value === undefined && metric.unavailableReason)).toBe(true);
  });

  it('maps all requested relationship operational metrics when typed facts are available', () => {
    const metrics = relationshipReportMetrics({ capability: capabilityState('reporting', 'available'), facts: { organizations: 4, contacts: 8, activeOpportunities: 2, activeCampaigns: 1, enrollments: 6, sends: 5, replies: 2, suppressions: 1, unsubscribes: 1, failures: 0, upcomingSends: 3 } });
    expect(metrics.find((metric) => metric.key === 'replies')).toMatchObject({ value: 2 });
    expect(metrics.find((metric) => metric.key === 'failures')).toMatchObject({ value: 0, unavailableReason: undefined });
  });
});
