import { describe, expect, it } from 'vitest';
import {
  availableRelationshipStageTransitions,
  interactionTypeLabel,
  relationshipStageLabel,
  validateInteractionDraft,
  validateStageTransitionDraft,
} from '@/domain/relationships/lifecycle-workflow';

describe('relationship lifecycle workflow rules', () => {
  it('exposes only allowed next stages', () => {
    expect(availableRelationshipStageTransitions('identified')).toEqual([
      'qualified_outreach',
      'nurture',
      'closed_no_fit',
      'inactive',
    ]);
    expect(availableRelationshipStageTransitions('active')).toEqual(['nurture', 'inactive']);
    expect(availableRelationshipStageTransitions()).toEqual([]);
  });

  it('requires an auditable reason and rejects invalid transitions', () => {
    expect(validateStageTransitionDraft({
      from: 'identified',
      to: 'qualified_outreach',
      reason: 'Research confirms a strong community fit.',
    })).toEqual({ valid: true, fieldErrors: {} });

    expect(validateStageTransitionDraft({
      from: 'identified',
      to: 'active',
      reason: '',
    })).toEqual({
      valid: false,
      fieldErrors: {
        to: 'That lifecycle transition is not allowed.',
        reason: 'Record a reason for the lifecycle change.',
      },
    });
  });

  it('validates manual interaction capture', () => {
    expect(validateInteractionDraft({
      type: 'meeting',
      occurredAt: '2026-07-21T12:00:00.000Z',
      summary: 'Discussed next steps for Beyond The Yellow.',
    })).toEqual({ valid: true, fieldErrors: {} });

    expect(validateInteractionDraft({
      type: 'system',
      occurredAt: 'not-a-date',
      summary: '   ',
    }).fieldErrors).toEqual({
      type: 'Select a supported manual interaction type.',
      occurredAt: 'Enter a valid interaction date and time.',
      summary: 'Describe the relationship interaction.',
    });
  });

  it('formats lifecycle and interaction labels for operators', () => {
    expect(relationshipStageLabel('next_step_agreed')).toBe('Next step agreed');
    expect(interactionTypeLabel('outbound_email')).toBe('Outbound email');
  });
});
