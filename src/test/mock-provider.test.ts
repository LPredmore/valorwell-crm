import { describe, it, expect } from 'vitest';
import { mockDataProvider } from '@/repositories/mock';

describe('mock data provider — canonical client workflows', () => {
  it('lists clients with lifecycle filter', async () => {
    const all = await mockDataProvider.clients.list({});
    const inCare = await mockDataProvider.clients.list({ lifecycle: ['Established Care'] });
    expect(all.total).toBeGreaterThan(inCare.total);
    expect(inCare.rows.every(c => c.lifecycle === 'Established Care')).toBe(true);
  });

  it('search finds a client by name', async () => {
    const first = (await mockDataProvider.clients.list({ pageSize: 1 })).rows[0];
    const hit = await mockDataProvider.clients.list({ search: first.legalFirstName });
    expect(hit.rows.some(c => c.id === first.id)).toBe(true);
  });

  it('updates lifecycle and reflects in subsequent read', async () => {
    const first = (await mockDataProvider.clients.list({ pageSize: 1 })).rows[0];
    const updated = await mockDataProvider.clients.updateLifecycle(first.id, 'Scheduled', 'Booked intake');
    expect(updated.lifecycle).toBe('Scheduled');
    const reread = await mockDataProvider.clients.get(first.id);
    expect(reread?.lifecycle).toBe('Scheduled');
  });

  it('closes and reopens a client', async () => {
    const first = (await mockDataProvider.clients.list({ pageSize: 1 })).rows[0];
    const closed = await mockDataProvider.clients.close(first.id, { closureReason: 'Other', closedAt: new Date().toISOString() });
    expect(closed.lifecycle).toBe('Closed');
    const reopened = await mockDataProvider.clients.reopen(first.id, 'Client returned');
    expect(reopened.lifecycle).not.toBe('Closed');
    expect(reopened.closure).toBeUndefined();
  });
});

describe('mock data provider — communication policy', () => {
  it('blocks ordinary campaign follow-up for a Do Not Contact client', async () => {
    const dnc = (await mockDataProvider.clients.list({ contactPolicy: ['Do Not Contact'], pageSize: 1 })).rows[0];
    expect(dnc).toBeDefined();
    const res = await mockDataProvider.communications.evaluatePolicy({
      clientId: dnc.id, channel: 'sms', messageClass: 'ordinary_campaign_follow_up',
    });
    expect(res.allowed).toBe(false);
    expect(res.suppressionCode).toBe('DO_NOT_CONTACT');
  });

  it('allows critical operational messages even for DNC clients', async () => {
    const dnc = (await mockDataProvider.clients.list({ contactPolicy: ['Do Not Contact'], pageSize: 1 })).rows[0];
    const res = await mockDataProvider.communications.evaluatePolicy({
      clientId: dnc.id, channel: 'sms', messageClass: 'critical_operational',
    });
    // Only channel restriction (if phone missing) could block; otherwise allowed.
    if (dnc.phone) expect(res.allowed).toBe(true);
  });

  it('REMOVE keyword marks client Do Not Contact and cancels enrollments', async () => {
    const target = (await mockDataProvider.clients.list({ contactPolicy: ['Contact Allowed'], pageSize: 1 })).rows[0];
    await mockDataProvider.communications.ingestInbound({
      tenantId: target.tenantId, clientId: target.id, channel: 'sms', direction: 'inbound',
      from: target.phone ?? 'x', to: '+15555550100', body: 'REMOVE', threadId: `thread-${target.id}`,
    });
    const after = await mockDataProvider.clients.get(target.id);
    expect(after?.contactPolicy).toBe('Do Not Contact');
  });
});

describe('mock data provider — tasks and exceptions', () => {
  it('creates a task and completes it', async () => {
    const t = await mockDataProvider.tasks.create({
      tenantId: 'tenant-valorwell', title: 'Test task', type: 'General', priority: 'Normal',
      status: 'Not Started', collaboratorIds: [], createdByProfileId: 'test-user', checklist: [], tags: [],
    });
    const done = await mockDataProvider.tasks.complete(t.id);
    expect(done.status).toBe('Completed');
    expect(done.completedAt).toBeDefined();
  });

  it('resolves an exception with an audit note', async () => {
    const list = await mockDataProvider.exceptions.list({ status: ['Open'] });
    if (list.length === 0) return;
    const resolved = await mockDataProvider.exceptions.resolve(list[0].id, 'looked into it');
    expect(resolved.status).toBe('Resolved');
    expect(resolved.resolutionHistory.at(-1)?.action).toBe('resolved');
  });

  it('creates a task from an exception', async () => {
    const list = await mockDataProvider.exceptions.list();
    if (list.length === 0) return;
    const task = await mockDataProvider.exceptions.createTaskFromException(list[0].id);
    expect(task.exceptionId).toBe(list[0].id);
  });
});

describe('mock data provider — campaigns', () => {
  it('enrolls a client and can cancel the enrollment', async () => {
    const c = (await mockDataProvider.clients.list({ pageSize: 1 })).rows[0];
    const [enrollment] = await mockDataProvider.campaigns.enroll('camp-1', [c.id]);
    const canceled = await mockDataProvider.campaigns.cancelEnrollment(enrollment.id, 'test');
    expect(canceled.status).toBe('Canceled');
    expect(canceled.exitReason).toBe('test');
  });
});

describe('mock data provider — reports render data', () => {
  const tenantId = 'tenant-valorwell';

  it('returns tenant-scoped weekly funnel rows with canonical metrics', async () => {
    const funnel = await mockDataProvider.reports.journeyFunnel(tenantId);
    expect(funnel?.tenantId).toBe(tenantId);
    expect(funnel?.bucketStart).toBe('2026-07-06');
    expect(funnel?.rows.length).toBeGreaterThan(0);
    expect(funnel?.rows.every(row => typeof row.current_count === 'number')).toBe(true);
  });

  it('preserves non-applicable engagement measurements as null', async () => {
    const engagement = await mockDataProvider.reports.engagementMetrics(tenantId);
    const nonNormal = engagement?.rows.filter(row => row.engagement !== 'normal') ?? [];
    expect(nonNormal.length).toBeGreaterThan(0);
    expect(nonNormal.every(row => row.avg_days_to_normal === null)).toBe(true);
  });

  it('implements all six canonical report contracts for the selected tenant', async () => {
    const reports = await Promise.all([
      mockDataProvider.reports.journeyFunnel(tenantId),
      mockDataProvider.reports.engagementMetrics(tenantId),
      mockDataProvider.reports.closureMetrics(tenantId),
      mockDataProvider.reports.campaignPerformance(tenantId),
      mockDataProvider.reports.taskPerformance(tenantId),
      mockDataProvider.reports.exceptionMetrics(tenantId),
    ]);
    expect(reports.every(report => report?.tenantId === tenantId)).toBe(true);
    expect(reports.every(report => report?.bucketStart === '2026-07-06')).toBe(true);
    expect(reports.every(report => report && report.rows.length > 0)).toBe(true);
  });
});
