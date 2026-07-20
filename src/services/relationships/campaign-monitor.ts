import type {
  RelationshipCommunicationLog,
  RelationshipEnrollment,
  RelationshipReply,
  RelationshipSuppression,
} from '@/domain/relationships/contracts';

export type RelationshipEligibilityChange = {
  enrollmentId: string;
  occurredAt: string;
  reason: string;
};

export type RelationshipCampaignMonitor = {
  enrollment: Record<RelationshipEnrollment['status'], number>;
  upcomingSends: number;
  sent: number;
  delivered: number;
  replies: number;
  failures: number;
  suppressions: number;
  pausedOrStopped: number;
  eligibilityChanges: RelationshipEligibilityChange[];
};

export type RelationshipCampaignMonitorInput = {
  enrollments: RelationshipEnrollment[];
  communications: RelationshipCommunicationLog[];
  replies: RelationshipReply[];
  suppressions: RelationshipSuppression[];
  eligibilityChanges?: RelationshipEligibilityChange[];
  now?: Date;
};

const enrollmentStatuses: RelationshipEnrollment['status'][] = [
  'pending', 'active', 'paused', 'responded', 'stopped', 'completed', 'failed', 'suppressed',
];

/**
 * Derives monitor facts from relationship records supplied by a typed adapter.
 * It is pure: no provider calls, writes, clinical campaigns, or client records.
 */
export function summarizeRelationshipCampaignMonitor(input: RelationshipCampaignMonitorInput): RelationshipCampaignMonitor {
  const now = input.now ?? new Date();
  const enrollment = Object.fromEntries(enrollmentStatuses.map((status) => [status, 0])) as RelationshipCampaignMonitor['enrollment'];
  for (const item of input.enrollments) enrollment[item.status] += 1;

  return {
    enrollment,
    upcomingSends: input.enrollments.filter((item) => item.nextScheduledAt && new Date(item.nextScheduledAt) >= now && ['pending', 'active'].includes(item.status)).length,
    sent: input.communications.filter((item) => item.direction === 'outbound' && ['sent', 'delivered'].includes(item.status)).length,
    delivered: input.communications.filter((item) => item.direction === 'outbound' && item.status === 'delivered').length,
    replies: input.replies.length,
    failures: input.communications.filter((item) => item.status === 'failed' || item.status === 'bounced').length + enrollment.failed,
    suppressions: input.suppressions.length + enrollment.suppressed,
    pausedOrStopped: enrollment.paused + enrollment.stopped,
    eligibilityChanges: input.eligibilityChanges ?? [],
  };
}
