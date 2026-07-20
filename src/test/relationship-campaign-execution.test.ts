import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { planRelationshipExecution, relationshipExecutionIdempotencyKey, relationshipRetryAt } from '@/services/relationships/execution/planner';

const item = {
  enrollmentId: 'enrollment-1', campaignId: 'campaign-1', dueAt: '2026-03-01T09:00:00.000Z', attempt: 1,
  idempotencyKey: 'relationship:campaign-1:enrollment-1:step-1', enrollmentStatus: 'active' as const,
  eligible: true, suppressed: false, unsubscribed: false,
  step: { id: 'step-1', position: 1, subjectTemplate: 'Hello', bodyTemplate: 'Body', delayDays: 0, stopOnReply: true },
};
const now = new Date('2026-03-01T10:00:00.000Z');

describe('relationship campaign execution source', () => {
  it('uses a stable relationship-only idempotency key and plans ready work without sending', () => {
    expect(relationshipExecutionIdempotencyKey(item)).toBe(item.idempotencyKey);
    expect(planRelationshipExecution({ item, workerId: 'worker-a', now })).toMatchObject({ outcome: 'ready' });
  });

  it('prevents duplicate work and concurrent workers from executing the same step', () => {
    expect(planRelationshipExecution({ item, workerId: 'worker-a', now, completedIdempotencyKeys: new Set([item.idempotencyKey]) }).outcome).toBe('skip_idempotent');
    expect(planRelationshipExecution({ item: { ...item, lock: { ownerId: 'worker-b', expiresAt: '2026-03-01T10:10:00.000Z' } }, workerId: 'worker-a', now }).outcome).toBe('skip_locked');
  });

  it('revalidates due, eligibility, suppression, and unsubscribe state before a future send', () => {
    expect(planRelationshipExecution({ item: { ...item, dueAt: '2026-03-01T11:00:00.000Z' }, workerId: 'worker-a', now }).outcome).toBe('skip_not_due');
    expect(planRelationshipExecution({ item: { ...item, eligible: false }, workerId: 'worker-a', now }).outcome).toBe('stopped');
    expect(planRelationshipExecution({ item: { ...item, suppressed: true }, workerId: 'worker-a', now }).outcome).toBe('stopped');
    expect(planRelationshipExecution({ item: { ...item, unsubscribed: true }, workerId: 'worker-a', now }).outcome).toBe('stopped');
  });

  it('plans bounded retries and campaign advancement without provider integration', () => {
    expect(relationshipRetryAt(now, 1)).toBe('2026-03-01T10:02:00.000Z');
    expect(planRelationshipExecution({ item, workerId: 'worker-a', now, providerFailure: 'retryable' })).toMatchObject({ outcome: 'retry', retryAt: '2026-03-01T10:02:00.000Z' });
    expect(planRelationshipExecution({ item, workerId: 'worker-a', now, hasNextStep: true }).outcome).toBe('advance');
    expect(planRelationshipExecution({ item, workerId: 'worker-a', now, hasNextStep: false }).outcome).toBe('completed');
  });

  it('does not import a clinical scheduler or campaign implementation', () => {
    const source = readFileSync(fileURLToPath(new URL('../services/relationships/execution/planner.ts', import.meta.url)), 'utf8');
    expect(source).not.toMatch(/from\s+['"][^'"]*(canonical|clinical|crm\/campaigns|clients)[^'"]*['"]/i);
  });
});
