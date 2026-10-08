import { describe, expect, it } from 'vitest';
import { buildActivityTimeline, pageTimeline } from './activity-timeline';
import type { RelationshipInteraction } from './contracts';
import type { RelationshipCommunication } from './delivery-contracts';

const interaction = (id: string, type: RelationshipInteraction['type'], occurredAt: string): RelationshipInteraction => ({
  id, type, occurredAt, summary: 'Recorded source activity', createdAt: occurredAt, updatedAt: occurredAt,
});
const message = (id: string, direction: RelationshipCommunication['direction'], occurredAt: string,
  status: RelationshipCommunication['status'] = 'sent'): RelationshipCommunication => ({
  id, direction, occurredAt, status, channel: 'email', senderEmail: 'team@example.org',
  recipientEmail: 'guest@example.org', metadata: {}, createdAt: occurredAt, updatedAt: occurredAt,
});
const later = '2026-10-08T15:00:00.000Z';
const earlier = '2026-10-07T15:00:00.000Z';

describe('nonclinical relationship activity timeline', () => {
  it('sorts newest first and preserves source provenance', () => {
    const events = buildActivityTimeline([interaction('a','meeting', earlier)], [message('b','outbound',later)]);
    expect(events.map(x => x.key)).toEqual(['communication:b','interaction:a']);
    expect(events.map(x => x.source)).toEqual(['relationship_communications','relationship_interactions']);
  });
  it('deduplicates mirrored same-time email interaction only when communication was actually recorded', () => {
    const rows = buildActivityTimeline(
      [interaction('audit','outbound_email',later), interaction('note','manual_note',later)],
      [message('sent','outbound',later)],
    );
    expect(rows.map(row => row.key).sort()).toEqual(['communication:sent','interaction:note']);
  });
  it('keeps unmatched audit and never manufactures verified delivery or replies', () => {
    const entries = buildActivityTimeline([interaction('reply','inbound_reply',earlier)], [message('queued','outbound',later,'scheduled')]);
    expect(entries).toHaveLength(2);
    expect(entries.find(x => x.sourceId === 'reply')?.verified).toBe(false);
    expect(entries.find(x => x.sourceId === 'queued')?.status).toBe('scheduled');
    expect(entries.find(x => x.sourceId === 'queued')?.verified).toBe(false);
  });
  it('never uses client-domain records in the input contract', () => {
    const rows = buildActivityTimeline([interaction('note','manual_note', earlier)], []);
    expect(rows[0]).not.toHaveProperty('clientId');
    expect(rows[0]).not.toHaveProperty('diagnosis');
  });
  it('shows a stable page prefix rather than skipping earlier history', () => {
    expect(pageTimeline([1,2,3,4,5],2,2)).toEqual([1,2,3,4]);
  });
});
