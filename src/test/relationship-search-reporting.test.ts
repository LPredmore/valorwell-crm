import { describe, expect, it } from 'vitest';
import {
  relationshipMetricState,
  relationshipOperationalMetricCatalog,
  relationshipSearchKinds,
  splitRelationshipReportMetrics,
} from '@/domain/relationships/reporting-contracts';

describe('relationship search and reporting contracts', () => {
  it('keeps unified search isolated to relationship record kinds', () => {
    expect(relationshipSearchKinds).toEqual(['organization', 'contact', 'opportunity', 'campaign']);
  });

  it('preserves a verified numeric zero as available data', () => {
    expect(relationshipMetricState({ key: 'active_outreach_campaigns', label: 'Active outreach campaigns', value: 0 }))
      .toEqual({ available: true, value: 0 });
  });

  it('keeps unavailable metrics distinct from zero', () => {
    expect(relationshipMetricState({ key: 'missing', label: 'Missing', unavailableReason: 'Database contract unavailable.' }))
      .toEqual({ available: false, reason: 'Database contract unavailable.' });
  });

  it('separates current operational metrics from selected-period activity', () => {
    const result = splitRelationshipReportMetrics([
      { key: 'total_contacts', label: 'Total contacts', value: 87 },
      { key: 'period_inbound_replies', label: 'Inbound replies', value: 0 },
    ]);
    expect(result.operational.map((metric) => metric.key)).toEqual(['total_contacts']);
    expect(result.period.map((metric) => metric.key)).toEqual(['period_inbound_replies']);
  });

  it('keeps the dashboard operational metric inventory stable', () => {
    expect(relationshipOperationalMetricCatalog.map(([key]) => key)).toEqual([
      'organizations_needing_review',
      'opportunities_needing_qualification',
      'overdue_next_actions',
      'unassigned_relationships',
      'active_outreach_campaigns',
      'replies_requiring_staff_action',
      'import_conflicts',
      'recently_updated_relationships',
    ]);
  });
});
