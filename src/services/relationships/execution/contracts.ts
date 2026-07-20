import type { RelationshipCampaignStep, RelationshipEnrollmentStatus } from '@/domain/relationships/contracts';

export type RelationshipExecutionWorkItem = {
  enrollmentId: string;
  campaignId: string;
  step: RelationshipCampaignStep;
  dueAt: string;
  attempt: number;
  idempotencyKey: string;
  lock?: { ownerId: string; expiresAt: string };
  enrollmentStatus: RelationshipEnrollmentStatus;
  eligible: boolean;
  suppressed: boolean;
  unsubscribed: boolean;
};

export type RelationshipExecutionAuditEvent = {
  enrollmentId: string;
  occurredAt: string;
  outcome: RelationshipExecutionDecision['outcome'];
  reason: string;
  idempotencyKey: string;
};

export type RelationshipExecutionDecision = {
  outcome: 'ready' | 'skip_locked' | 'skip_not_due' | 'skip_idempotent' | 'stopped' | 'retry' | 'advance' | 'completed';
  reason: string;
  retryAt?: string;
};

export type RelationshipRenderedMessage = { subject: string; body: string };
export type RelationshipProviderSendResult = { providerMessageId: string };

/**
 * Boundary for a future relationship-only execution adapter. It is not wired
 * to any provider, scheduler, database, or clinical campaign service.
 */
export interface RelationshipCampaignExecutionAdapter {
  claimDueWork(input: { workerId: string; now: string; limit: number }): Promise<RelationshipExecutionWorkItem[]>;
  render(item: RelationshipExecutionWorkItem): Promise<RelationshipRenderedMessage>;
  send(input: { item: RelationshipExecutionWorkItem; message: RelationshipRenderedMessage }): Promise<RelationshipProviderSendResult>;
  recordAudit(event: RelationshipExecutionAuditEvent): Promise<void>;
}
