import type { RelationshipCommunicationLog, RelationshipReply } from '@/domain/relationships/contracts';

export type RelationshipInboundReply = {
  providerMessageId?: string;
  receivedAt: string;
  body: string;
  fromEmail?: string;
};

export type RelationshipReplyProcessingPlan = {
  match: RelationshipCommunicationLog | null;
  replyStatus: RelationshipReply['status'];
  stopEnrollment: boolean;
  interactionSummary: string;
  auditSummary: string;
  suggestedOwnerId?: string;
  suggestedNextAction: string;
};

/**
 * Matches and plans an inbound reply using only relationship communication
 * records. It does not write a reply, stop an enrollment, or touch clinical
 * inboxes; a future typed relationship adapter must carry out the plan.
 */
export function planRelationshipReplyProcessing(input: {
  inbound: RelationshipInboundReply;
  communications: RelationshipCommunicationLog[];
  ownerId?: string;
}): RelationshipReplyProcessingPlan {
  const match = input.inbound.providerMessageId
    ? input.communications.find((item) => item.providerMessageId === input.inbound.providerMessageId) ?? null
    : null;
  const normalizedBody = input.inbound.body.trim().toLowerCase();
  const hasUnsubscribeIntent = /\b(stop|unsubscribe|remove)\b/.test(normalizedBody);
  const hasResponse = normalizedBody.length > 0;
  const replyStatus: RelationshipReply['status'] = hasUnsubscribeIntent ? 'resolved' : hasResponse ? 'needs_action' : 'new';
  const matchContext = match?.enrollmentId ? `enrollment ${match.enrollmentId}` : 'an unmatched relationship message';

  return {
    match,
    replyStatus,
    stopEnrollment: Boolean(match?.enrollmentId && hasResponse),
    interactionSummary: `Inbound relationship reply received for ${matchContext}.`,
    auditSummary: hasUnsubscribeIntent
      ? 'Inbound relationship reply requested outreach to stop; create a relationship suppression through the typed adapter.'
      : 'Inbound relationship reply requires relationship-workspace follow-up.',
    suggestedOwnerId: input.ownerId,
    suggestedNextAction: hasUnsubscribeIntent ? 'Confirm relationship suppression and close the reply.' : 'Review the relationship reply and schedule the next action.',
  };
}
