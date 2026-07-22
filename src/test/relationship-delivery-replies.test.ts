import { describe, expect, it } from 'vitest';
import { relationshipCommunicationStatuses, relationshipReplyStatuses } from '@/domain/relationships/delivery-contracts';
import { mapRelationshipEnrollmentResponse } from '@/repositories/supabase/relationships-enrollment-mappers';

describe('relationship delivery and reply contracts', () => {
  it('keeps canonical communication and reply states explicit', () => {
    expect(relationshipCommunicationStatuses).toEqual(['scheduled', 'sent', 'delivered', 'failed', 'bounced', 'received']);
    expect(relationshipReplyStatuses).toEqual(['new', 'needs_action', 'in_progress', 'resolved']);
  });

  it('maps controlled delivery activation truthfully', () => {
    const enrollment = mapRelationshipEnrollmentResponse({
      id: 'enrollment-1',
      campaignId: 'campaign-1',
      contactId: 'contact-1',
      recipientEmail: 'partner@example.org',
      status: 'active',
      sourceLanguageMode: 'none',
      personalizationContext: {},
      eligibilitySnapshot: {
        target: { contactId: 'contact-1' },
        eligible: true,
        reasons: [],
        resolvedContactId: 'contact-1',
        recipientEmail: 'partner@example.org',
        sourceLanguageMode: 'none',
        personalizationContext: {},
      },
      safetyStatus: 'ready',
      safetySnapshot: {},
      deliveryEnabled: true,
      version: 4,
      createdAt: '2026-07-22T00:00:00.000Z',
      updatedAt: '2026-07-22T00:00:00.000Z',
    });

    expect(enrollment.safetyStatus).toBe('ready');
    expect(enrollment.deliveryEnabled).toBe(true);
    expect(enrollment.version).toBe(4);
  });

  it('does not infer delivery activation when the field is absent', () => {
    const enrollment = mapRelationshipEnrollmentResponse({
      id: 'enrollment-2',
      campaignId: 'campaign-2',
      contactId: 'contact-2',
      recipientEmail: 'blocked@example.org',
      status: 'pending',
      sourceLanguageMode: 'none',
      personalizationContext: {},
      eligibilitySnapshot: {
        target: { contactId: 'contact-2' },
        eligible: true,
        reasons: [],
        resolvedContactId: 'contact-2',
        recipientEmail: 'blocked@example.org',
        sourceLanguageMode: 'none',
        personalizationContext: {},
      },
      safetyStatus: 'ready',
      safetySnapshot: {},
      version: 1,
      createdAt: '2026-07-22T00:00:00.000Z',
      updatedAt: '2026-07-22T00:00:00.000Z',
    });

    expect(enrollment.deliveryEnabled).toBe(false);
  });
});
