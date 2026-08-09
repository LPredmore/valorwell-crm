export const ACTIVATION_FLAG_ORDER = [
  'relationship_activity_capture_enabled',
  'relationship_activity_mutation_enabled',
  'relationship_bty_auto_enrollment_enabled',
  'relationship_gmail_observation_enabled',
  'relationship_calendar_observation_enabled',
  'relationship_reconciliation_writes_enabled',
] as const;

export type ActivationFlagName = (typeof ACTIVATION_FLAG_ORDER)[number];

export const ACTIVATION_FLAG_LABELS: Record<ActivationFlagName, string> = {
  relationship_activity_capture_enabled: 'Activity capture',
  relationship_activity_mutation_enabled: 'Automatic lifecycle mutation',
  relationship_bty_auto_enrollment_enabled: 'BTY auto-enrollment',
  relationship_gmail_observation_enabled: 'Gmail observation effects',
  relationship_calendar_observation_enabled: 'Calendar observation effects',
  relationship_reconciliation_writes_enabled: 'Legacy reconciliation writes',
};

export type ActivationFlag = { flagName: string; enabled: boolean; updatedAt?: string };

export type FlagGate = { canEnable: boolean; blockedReason?: string };

/**
 * Mirrors the database guard rails in public.set_relationship_feature_flag so the
 * console can explain a blocked switch before the request is attempted.
 */
export function evaluateFlagGate(
  flagName: string,
  flags: Record<string, boolean>,
  invariants: Record<string, number>,
): FlagGate {
  if (flags[flagName]) return { canEnable: true };

  if (flagName === 'relationship_activity_mutation_enabled') {
    const nonZero = Object.entries(invariants).filter(([, count]) => Number(count) !== 0);
    if (nonZero.length > 0) {
      return {
        canEnable: false,
        blockedReason: `Integrity invariants must all read zero. Non-zero: ${nonZero
          .map(([name, count]) => `${name} (${count})`)
          .join(', ')}.`,
      };
    }
    return { canEnable: true };
  }

  if (
    flagName === 'relationship_bty_auto_enrollment_enabled' ||
    flagName === 'relationship_reconciliation_writes_enabled'
  ) {
    if (!flags.relationship_activity_mutation_enabled) {
      return { canEnable: false, blockedReason: 'Automatic lifecycle mutation must be enabled first.' };
    }
  }

  return { canEnable: true };
}

export type ReconciliationProposal = {
  opportunityId: string;
  currentStatus: string;
  proposedStatus: string;
  evidenceType?: string;
  evidence?: Record<string, boolean>;
  algorithmVersion?: string;
};

export function reconciliationErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/changed after dry-run review/i.test(message)) {
    return 'An opportunity changed since the dry run — regenerate the dry run and review again.';
  }
  if (/reconciliation writes are disabled/i.test(message)) {
    return 'Legacy reconciliation writes are disabled. Enable the reconciliation switch first.';
  }
  return message || 'Reconciliation could not be applied.';
}

const OPERATOR_ACTION_PRECONDITIONS: Record<string, string[] | null> = {
  interest_confirmed: null,
  scheduling_started: null,
  declined: null,
  nurture_set: null,
  recording_completed: ['booked'],
};

export function canRunOperatorAction(activityType: string, opportunityStatus: string): boolean {
  const allowed = OPERATOR_ACTION_PRECONDITIONS[activityType];
  if (allowed === undefined) return false;
  if (allowed === null) return true;
  return allowed.includes(opportunityStatus);
}
