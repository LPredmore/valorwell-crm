import { describe, expect, it } from 'vitest';
import { planRelationshipReplyProcessing } from '@/services/relationships/replies/reply-processing';

const audit = { createdAt: '2026-03-01T00:00:00.000Z', updatedAt: '2026-03-01T00:00:00.000Z' };
const communication = { ...audit, id: 'message-1', enrollmentId: 'enrollment-1', organizationId: 'organization-1', contactId: 'contact-1', direction: 'outbound' as const, channel: 'email' as const, status: 'sent' as const, providerMessageId: 'provider-1', occurredAt: audit.createdAt };

describe('relationship reply processing', () => {
  it('matches an inbound reply to relationship communication and stops the related enrollment', () => {
    const plan = planRelationshipReplyProcessing({ inbound: { providerMessageId: 'provider-1', receivedAt: audit.updatedAt, body: 'Yes, please send details.' }, communications: [communication], ownerId: 'staff-1' });
    expect(plan.match?.id).toBe('message-1');
    expect(plan).toMatchObject({ replyStatus: 'needs_action', stopEnrollment: true, suggestedOwnerId: 'staff-1' });
    expect(plan.interactionSummary).toContain('enrollment-1');
  });

  it('plans relationship suppression follow-up for a stop request without writing one', () => {
    const plan = planRelationshipReplyProcessing({ inbound: { providerMessageId: 'provider-1', receivedAt: audit.updatedAt, body: 'Please remove us from your list.' }, communications: [communication] });
    expect(plan).toMatchObject({ replyStatus: 'resolved', stopEnrollment: true });
    expect(plan.auditSummary).toContain('suppression');
  });

  it('keeps unmatched replies in the relationship inbox for staff review', () => {
    const plan = planRelationshipReplyProcessing({ inbound: { receivedAt: audit.updatedAt, body: 'Who is this?' }, communications: [] });
    expect(plan).toMatchObject({ match: null, replyStatus: 'needs_action', stopEnrollment: false });
    expect(plan.suggestedNextAction).toContain('Review');
  });
});
