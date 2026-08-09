import { describe, expect, it } from 'vitest';
import {
  ACTIVATION_FLAG_ORDER,
  canRunOperatorAction,
  evaluateFlagGate,
  reconciliationErrorMessage,
} from '@/domain/relationships/activation-gating';

describe('activation gating', () => {
  it('orders activation switches with capture first and mutation before dependants', () => {
    expect(ACTIVATION_FLAG_ORDER[0]).toBe('relationship_activity_capture_enabled');
    expect(ACTIVATION_FLAG_ORDER.indexOf('relationship_activity_mutation_enabled')).toBeLessThan(
      ACTIVATION_FLAG_ORDER.indexOf('relationship_bty_auto_enrollment_enabled'),
    );
  });

  it('blocks mutation while any invariant is non-zero', () => {
    const gate = evaluateFlagGate('relationship_activity_mutation_enabled', {}, { duplicateCanonicalCommunication: 2 });
    expect(gate.canEnable).toBe(false);
    expect(gate.blockedReason).toContain('duplicateCanonicalCommunication (2)');
  });

  it('allows mutation when every invariant is zero', () => {
    expect(evaluateFlagGate('relationship_activity_mutation_enabled', {}, { a: 0, b: 0 }).canEnable).toBe(true);
  });

  it('blocks auto-enrollment and reconciliation writes until mutation is enabled', () => {
    expect(evaluateFlagGate('relationship_bty_auto_enrollment_enabled', {}, {}).canEnable).toBe(false);
    expect(evaluateFlagGate('relationship_reconciliation_writes_enabled', {}, {}).canEnable).toBe(false);
    const flags = { relationship_activity_mutation_enabled: true };
    expect(evaluateFlagGate('relationship_bty_auto_enrollment_enabled', flags, {}).canEnable).toBe(true);
  });

  it('never blocks disabling an already-enabled switch', () => {
    const gate = evaluateFlagGate('relationship_activity_mutation_enabled', { relationship_activity_mutation_enabled: true }, { a: 3 });
    expect(gate.canEnable).toBe(true);
  });

  it('allows Gmail and Calendar observation independently', () => {
    expect(evaluateFlagGate('relationship_gmail_observation_enabled', {}, {}).canEnable).toBe(true);
    expect(evaluateFlagGate('relationship_calendar_observation_enabled', {}, {}).canEnable).toBe(true);
  });
});

describe('reconciliation error messages', () => {
  it('explains the dry-run concurrency failure', () => {
    const message = reconciliationErrorMessage(new Error('Reconciliation opportunity changed after dry-run review.'));
    expect(message).toContain('regenerate the dry run');
  });

  it('explains the disabled write gate', () => {
    expect(reconciliationErrorMessage(new Error('Relationship reconciliation writes are disabled.'))).toContain('Enable the reconciliation switch');
  });

  it('passes through unrelated errors', () => {
    expect(reconciliationErrorMessage(new Error('network down'))).toBe('network down');
  });
});

describe('operator action guard', () => {
  it('only allows recording completion from booked', () => {
    expect(canRunOperatorAction('recording_completed', 'booked')).toBe(true);
    expect(canRunOperatorAction('recording_completed', 'interested')).toBe(false);
  });

  it('allows the other operator activities from any status', () => {
    for (const action of ['interest_confirmed', 'scheduling_started', 'declined', 'nurture_set']) {
      expect(canRunOperatorAction(action, 'contacted')).toBe(true);
    }
  });

  it('rejects unknown activity types', () => {
    expect(canRunOperatorAction('outreach_sent', 'booked')).toBe(false);
  });
});
