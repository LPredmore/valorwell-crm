import { describe, expect, it } from 'vitest';
import { summarizeRelationshipCampaignMonitor } from '@/services/relationships/campaign-monitor';

const audit = { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };

describe('relationship campaign monitor', () => {
  it('summarizes relationship enrollment, send, reply, failure, and suppression facts', () => {
    const summary = summarizeRelationshipCampaignMonitor({
      now: new Date('2026-02-01T00:00:00.000Z'),
      enrollments: [
        { ...audit, id: 'active', campaignId: 'campaign', status: 'active', nextScheduledAt: '2026-02-02T00:00:00.000Z' },
        { ...audit, id: 'paused', campaignId: 'campaign', status: 'paused' },
        { ...audit, id: 'suppressed', campaignId: 'campaign', status: 'suppressed' },
        { ...audit, id: 'failed', campaignId: 'campaign', status: 'failed' },
      ],
      communications: [
        { ...audit, id: 'sent', direction: 'outbound', channel: 'email', status: 'sent', occurredAt: audit.createdAt },
        { ...audit, id: 'delivered', direction: 'outbound', channel: 'email', status: 'delivered', occurredAt: audit.createdAt },
        { ...audit, id: 'bounce', direction: 'outbound', channel: 'email', status: 'bounced', occurredAt: audit.createdAt },
      ],
      replies: [{ ...audit, id: 'reply', communicationLogId: 'delivered', receivedAt: audit.createdAt, body: 'Interested', status: 'new' }],
      suppressions: [{ ...audit, id: 'suppression', scope: 'contact', reason: 'unsubscribe', contactId: 'contact', effectiveAt: audit.createdAt }],
      eligibilityChanges: [{ enrollmentId: 'active', occurredAt: audit.createdAt, reason: 'Email review completed' }],
    });

    expect(summary).toMatchObject({ upcomingSends: 1, sent: 2, delivered: 1, replies: 1, failures: 2, suppressions: 2, pausedOrStopped: 1 });
    expect(summary.enrollment).toMatchObject({ active: 1, paused: 1, suppressed: 1, failed: 1 });
    expect(summary.eligibilityChanges).toHaveLength(1);
  });

  it('keeps an empty relationship monitor truthful rather than inventing activity', () => {
    const summary = summarizeRelationshipCampaignMonitor({ enrollments: [], communications: [], replies: [], suppressions: [] });
    expect(summary.upcomingSends).toBe(0);
    expect(summary.enrollment.active).toBe(0);
    expect(summary.eligibilityChanges).toEqual([]);
  });
});
