import type { RelationshipExecutionDecision, RelationshipExecutionWorkItem } from './contracts';

export function relationshipExecutionIdempotencyKey(item: Pick<RelationshipExecutionWorkItem, 'campaignId' | 'enrollmentId' | 'step'>) {
  return `relationship:${item.campaignId}:${item.enrollmentId}:${item.step.id}`;
}

export function relationshipRetryAt(now: Date, attempt: number) {
  const minutes = Math.min(60, 2 ** Math.max(0, attempt));
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

/** Plans one non-deployed, relationship-only execution attempt. It never sends a message. */
export function planRelationshipExecution(input: {
  item: RelationshipExecutionWorkItem;
  workerId: string;
  now?: Date;
  completedIdempotencyKeys?: ReadonlySet<string>;
  providerFailure?: 'retryable' | 'permanent';
  hasNextStep?: boolean;
}): RelationshipExecutionDecision {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const { item } = input;

  if (input.completedIdempotencyKeys?.has(item.idempotencyKey)) return { outcome: 'skip_idempotent', reason: 'This campaign step already completed for its idempotency key.' };
  if (item.lock && item.lock.ownerId !== input.workerId && item.lock.expiresAt > nowIso) return { outcome: 'skip_locked', reason: 'Another relationship worker currently holds the execution lock.' };
  if (item.dueAt > nowIso) return { outcome: 'skip_not_due', reason: 'The relationship campaign step is not due yet.' };
  if (item.suppressed || item.unsubscribed) return { outcome: 'stopped', reason: 'A relationship suppression or unsubscribe stops this enrollment.' };
  if (!item.eligible) return { outcome: 'stopped', reason: 'The relationship target is no longer eligible for this campaign.' };
  if (!['pending', 'active'].includes(item.enrollmentStatus)) return { outcome: 'stopped', reason: `The enrollment is ${item.enrollmentStatus} and cannot send.` };
  if (input.providerFailure === 'retryable') return { outcome: 'retry', reason: 'A future provider adapter reported a retryable failure.', retryAt: relationshipRetryAt(now, item.attempt) };
  if (input.providerFailure === 'permanent') return { outcome: 'stopped', reason: 'A future provider adapter reported a permanent failure.' };
  if (input.hasNextStep === false) return { outcome: 'completed', reason: 'The relationship campaign completed its final step.' };
  if (input.hasNextStep) return { outcome: 'advance', reason: 'The relationship campaign step is ready to advance after a successful future send.' };
  return { outcome: 'ready', reason: 'The relationship campaign step is ready for a future provider adapter.' };
}
