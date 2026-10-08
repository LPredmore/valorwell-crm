import type { RelationshipInteraction } from './contracts';
import type { RelationshipCommunication } from './delivery-contracts';

export type TimelineChannel = 'email' | 'call' | 'meeting' | 'note' | 'system';
export interface TimelineEntry {
  key: string;
  sourceId: string;
  kind: 'communication' | 'interaction';
  source: 'relationship_communications' | 'relationship_interactions';
  title: string;
  summary?: string;
  timestamp: string;
  channel: TimelineChannel;
  direction?: 'inbound' | 'outbound';
  status?: string;
  sender?: string;
  recipient?: string;
  campaignId?: string;
  actorId?: string;
  verified: boolean;
}
const isEmailInteraction = (type: RelationshipInteraction['type']) =>
  type === 'outbound_email' || type === 'inbound_reply';

function channelForInteraction(type: RelationshipInteraction['type']): TimelineChannel {
  if (isEmailInteraction(type)) return 'email';
  if (type === 'phone_call') return 'call';
  if (type === 'meeting') return 'meeting';
  if (type === 'manual_note') return 'note';
  return 'system';
}

/** Provider-sourced communications supersede mirrored email interaction audit records.
 * Audits without matching communications remain visible as unverified activity. */
export function buildActivityTimeline(
  interactions: readonly RelationshipInteraction[],
  communications: readonly RelationshipCommunication[],
): TimelineEntry[] {
  const messages = communications.map(message => ({
    key: 'communication:' + message.id,
    sourceId: message.id,
    kind: 'communication' as const,
    source: 'relationship_communications' as const,
    title: message.subject?.trim() || (message.direction === 'inbound' ? 'Inbound email' : 'Outbound email'),
    timestamp: message.occurredAt,
    channel: 'email' as const,
    direction: message.direction,
    status: message.status,
    sender: message.senderEmail,
    recipient: message.recipientEmail,
    campaignId: message.campaignId,
    verified: Boolean(message.providerMessageId) || ['sent', 'delivered', 'received', 'failed', 'bounced'].includes(message.status),
  }));
  const messageKeys = new Set(messages.map(message => message.key));
  const emailMessageTimes = messages.filter(message => message.verified);
  const audits = interactions.flatMap(interaction => {
    // An email interaction audit can be a second representation of the same
    // communication. Only suppress an exact same-direction, same-time audit;
    // never infer reply/delivery or hide unrelated manual activity.
    if (isEmailInteraction(interaction.type) && emailMessageTimes.some(message =>
      message.direction === (interaction.type === 'outbound_email' ? 'outbound' : 'inbound')
      && message.timestamp === interaction.occurredAt
    )) return [];
    return [{
      key: 'interaction:' + interaction.id,
      sourceId: interaction.id,
      kind: 'interaction' as const,
      source: 'relationship_interactions' as const,
      title: interaction.type.replace(/_/g, ' '),
      summary: interaction.summary,
      timestamp: interaction.occurredAt,
      channel: channelForInteraction(interaction.type),
      direction: interaction.type === 'outbound_email' ? 'outbound' as const
        : interaction.type === 'inbound_reply' ? 'inbound' as const : undefined,
      actorId: interaction.actorId,
      verified: false,
    }];
  });
  return [...messages, ...audits]
    .filter(entry => entry.timestamp && (entry.kind !== 'communication' || messageKeys.has(entry.key)))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp) || a.key.localeCompare(b.key));
}

export function pageTimeline<T>(rows: readonly T[], page: number, size: number): T[] {
  return rows.slice(0, Math.max(1, page) * size);
}
