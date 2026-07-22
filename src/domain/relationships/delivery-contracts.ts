import type { AuditMetadata, PageResult } from './contracts';

export const relationshipCommunicationStatuses = ['scheduled', 'sent', 'delivered', 'failed', 'bounced', 'received'] as const;
export type RelationshipCommunicationStatus = (typeof relationshipCommunicationStatuses)[number];

export type RelationshipCommunication = AuditMetadata & {
  id: string;
  workItemId?: string;
  campaignId?: string;
  campaignStepId?: string;
  enrollmentId?: string;
  organizationId?: string;
  contactId?: string;
  opportunityId?: string;
  direction: 'outbound' | 'inbound';
  channel: 'email';
  status: RelationshipCommunicationStatus;
  senderEmail: string;
  recipientEmail: string;
  subject?: string;
  renderedBody?: string;
  provider?: 'resend';
  providerMessageId?: string;
  providerThreadId?: string;
  occurredAt: string;
  scheduledFor?: string;
  sentAt?: string;
  deliveredAt?: string;
  failedAt?: string;
  errorCode?: string;
  errorMessage?: string;
  metadata: Record<string, unknown>;
};

export type RelationshipCommunicationEvent = {
  id: string;
  communicationId: string;
  provider: string;
  providerEventId?: string;
  eventType: string;
  occurredAt: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export const relationshipReplyStatuses = ['new', 'needs_action', 'in_progress', 'resolved'] as const;
export type RelationshipReplyStatus = (typeof relationshipReplyStatuses)[number];

export type RelationshipReply = AuditMetadata & {
  id: string;
  communicationLogId: string;
  enrollmentId?: string;
  organizationId?: string;
  contactId?: string;
  opportunityId?: string;
  ownerId?: string;
  receivedAt: string;
  senderEmail: string;
  recipientEmail: string;
  subject?: string;
  body: string;
  status: RelationshipReplyStatus;
  followUpDueAt?: string;
  resolvedAt?: string;
  version: number;
  metadata: Record<string, unknown>;
};

export type RelationshipReplyFilters = {
  statuses?: RelationshipReplyStatus[];
  ownerId?: string;
  unownedOnly?: boolean;
  page?: number;
  pageSize?: number;
};

export type RelationshipReplyPage = PageResult<RelationshipReply>;

export type UpdateRelationshipReplyInput = {
  expectedVersion: number;
  status?: RelationshipReplyStatus;
  ownerId?: string;
  followUpDueAt?: string;
  reason?: string;
  idempotencyKey?: string;
};

export type RelationshipDeliveryReadiness = {
  ready: boolean;
  reasons: string[];
  campaignId: string;
  executionEnabled: boolean;
  provider: 'resend';
  providerStatus: 'disabled' | 'test' | 'ready' | 'suspended';
  senderEmail?: string;
  inboundAddress?: string;
  webhookEndpoint?: string;
  lastVerifiedAt?: string;
};

export type SetRelationshipCampaignExecutionInput = {
  enabled: boolean;
  expectedVersion: number;
  reason?: string;
  idempotencyKey?: string;
};

export type RelationshipCampaignExecutionResult = {
  campaignId: string;
  executionEnabled: boolean;
  version: number;
  readiness: RelationshipDeliveryReadiness;
};
