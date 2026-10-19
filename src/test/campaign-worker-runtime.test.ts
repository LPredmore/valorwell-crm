// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { edgeRuntime } from './edge-worker-runtime';

const trigger = 'supabase/functions/campaign-trigger-worker/index.ts';
const relationship = 'supabase/functions/relationship-campaign-worker/index.ts';
const service = { authorization: 'Bearer synthetic-service' };
const job = { tenantId: '00000000-0000-0000-0000-000000000001', workItemId: 'synthetic-work', claimToken: 'synthetic-lease', attemptCount: 1, maxAttempts: 3 };
const communication = { id: 'synthetic-communication', senderEmail: 'sender@example.invalid', recipientEmail: 'recipient@example.invalid', subject: 'Synthetic', renderedText: 'Synthetic only', providerIdempotencyKey: 'stable-synthetic-delivery' };

function delivery(options: { status?: number; networkError?: boolean; attempt?: number; prepareError?: boolean; reply?: boolean; rootMissing?: boolean; recordingError?: boolean; tenantId?: string } = {}) {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === 'claim_relationship_campaign_work') return { data: [{ ...job, tenantId: options.tenantId ?? job.tenantId, attemptCount: options.attempt ?? 1 }], error: null };
    if (name === 'prepare_relationship_campaign_delivery') return options.prepareError ? { data: null, error: { message: 'suppressed' } } : { data: communication, error: null };
    if (name === 'relationship_worker_token_valid') return { data: args.p_token === 'synthetic-worker-token', error: null };
    return options.recordingError ? { data: null, error: { message: 'record unavailable' } } : { data: { outcome: args.p_outcome }, error: null };
  });
  const queries: { table: string; filters: [string, unknown][] }[] = [];
  const db = { rpc, from: (table: string) => {
    const query = { table, filters: [] as [string, unknown][] }; queries.push(query);
    const result = () => {
      if (table === 'relationship_campaign_steps') return { data: options.reply && query.filters.some(([key]) => key === 'position') ? { id: 'root-step' } : { position: 2, metadata: { sendAsReply: !!options.reply } }, error: null };
      if (query.filters.some(([key]) => key === 'direction')) return { data: options.rootMissing ? null : { subject: 'Original subject', provider_message_id: 'root-provider', provider_thread_id: '<synthetic-root@example.invalid>' }, error: null };
      return { data: { campaign_id: 'campaign', campaign_step_id: 'step', enrollment_id: 'enrollment' }, error: null };
    };
    const chain = { select: () => chain, eq: (key: string, value: unknown) => { query.filters.push([key, value]); return chain; }, in: () => chain, not: () => chain, order: () => chain, limit: () => chain, single: async () => result(), maybeSingle: async () => result() };
    return chain;
  } };
  const transport = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    if (init?.method !== 'POST') return Response.json({ message_id: '<synthetic-sent@example.invalid>' });
    if (options.networkError) throw new Error('synthetic transport outage');
    return Response.json(options.status && options.status !== 200 ? { name: 'synthetic_error', message: 'Synthetic rejection' } : { id: 'synthetic-provider-id' }, { status: options.status ?? 200 });
  });
  return { rpc, queries, transport, run: edgeRuntime(relationship, { db, fetch: transport as typeof fetch }) };
}

describe('actual campaign trigger Edge handler (synthetic RPC boundary)', () => {
  it.each(['', 'Bearer browser', 'Bearer synthetic-service-extra'])('denies %j without claiming work', async (authorization) => {
    const rpc = vi.fn(); const run = edgeRuntime(trigger, { db: { rpc } });
    expect((await run({}, { authorization })).status).toBe(403); expect(rpc).not.toHaveBeenCalled();
  });
  it.each([service, { 'x-cron-secret': 'synthetic-cron' }])('claims and executes using the returned lease only', async (headers) => {
    const rpc = vi.fn(async (name: string) => ({ data: name === 'crm_claim_campaign_trigger_jobs' ? [{ jobId: 'job', claimToken: 'lease' }] : { outcome: 'enrolled' }, error: null }));
    const response = await edgeRuntime(trigger, { db: { rpc } })({ limit: 999, workerId: 'synthetic-runner', claimToken: 'attacker' }, headers);
    expect(response.status).toBe(200); expect(rpc.mock.calls[0][0]).toBe('crm_claim_campaign_trigger_jobs');
    expect(rpc).toHaveBeenCalledWith('crm_claim_campaign_trigger_jobs', { p_worker_id: 'synthetic-runner', p_limit: 200, p_lease_seconds: 300 });
    expect(rpc).toHaveBeenCalledWith('crm_execute_campaign_trigger_job', { p_job_id: 'job', p_claim_token: 'lease' });
  });
  it('continues after one job fails and reports the failure', async () => {
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => name === 'crm_claim_campaign_trigger_jobs' ? { data: [{ jobId: 'bad', claimToken: 'a' }, { jobId: 'good', claimToken: 'b' }], error: null } : { data: { outcome: 'enrolled' }, error: args.p_job_id === 'bad' ? { message: 'synthetic failure' } : null });
    const body = await (await edgeRuntime(trigger, { db: { rpc } })({}, service)).json();
    expect(body.results.map((r: { outcome: string }) => r.outcome)).toEqual(['execution_error', 'enrolled']);
  });
  it('reports claim failure without attempting execution', async () => {
    const rpc = vi.fn(async () => ({ error: { message: 'claim failure' } }));
    expect((await edgeRuntime(trigger, { db: { rpc } })({}, service)).status).toBe(500); expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe('actual relationship worker orchestration (synthetic RPC and provider)', () => {
  it('rejects browser callers before claiming work or contacting providers', async () => {
    const t = delivery(); expect((await t.run({}, { authorization: 'Bearer browser' })).status).toBe(403);
    expect(t.rpc).not.toHaveBeenCalled(); expect(t.transport).not.toHaveBeenCalled();
  });
  it.each(['wrong', 'synthetic-worker-token'])('checks worker token %s before work', async (token) => {
    const t = delivery(); const response = await t.run({}, { 'x-relationship-worker-token': token });
    expect(response.status).toBe(token === 'wrong' ? 403 : 200);
    expect(t.rpc).toHaveBeenCalledWith('relationship_worker_token_valid', { p_tenant_id: '00000000-0000-0000-0000-000000000001', p_token: token });
    if (token === 'wrong') expect(t.transport).not.toHaveBeenCalled();
  });
  it('prepares, sends, resolves Message-ID, and records synthetic association and lease', async () => {
    const t = delivery(); const response = await t.run({}, service); expect(response.status).toBe(200);
    expect(t.rpc.mock.calls.map(([name]) => name)).toEqual(['claim_relationship_campaign_work', 'prepare_relationship_campaign_delivery', 'record_relationship_delivery_result']);
    const post = t.transport.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(post[0]).toBe('https://api.resend.com/emails');
    expect(JSON.parse(post[1]!.body as string)).toMatchObject({ to: ['recipient@example.invalid'], headers: { 'X-Relationship-Communication-ID': communication.id } });
    expect((post[1]!.headers as Record<string, string>)['idempotency-key']).toBe(communication.providerIdempotencyKey);
    expect(t.rpc).toHaveBeenLastCalledWith('record_relationship_delivery_result', expect.objectContaining({ p_communication_id: communication.id, p_claim_token: job.claimToken, p_outcome: 'sent', p_provider_message_id: 'synthetic-provider-id', p_provider_thread_id: '<synthetic-sent@example.invalid>' }));
    expect(t.queries.every((q) => q.filters.some(([key, value]) => key === 'tenant_id' && value === '00000000-0000-0000-0000-000000000001'))).toBe(true);
  });
  it('loads communication and thread context from the tenant returned by the trusted claim', async () => {
    const tenantId = '22222222-2222-4222-8222-222222222222';
    const t = delivery({ reply: true, tenantId });
    await t.run({}, service);
    expect(t.transport).toHaveBeenCalled();
    expect(t.queries.length).toBeGreaterThan(2);
    expect(t.queries.every((q) => q.filters.some(([key, value]) => key === 'tenant_id' && value === tenantId))).toBe(true);
  });
  it.each([429, 500, 503])('retries transient provider status %i with a scheduled backoff', async (status) => {
    const t = delivery({ status }); await t.run({}, service);
    expect(t.rpc).toHaveBeenLastCalledWith('record_relationship_delivery_result', expect.objectContaining({ p_outcome: 'retry', p_retry_at: expect.any(String), p_claim_token: job.claimToken }));
  });
  it.each([400, 401, 403, 422])('records permanent provider status %i as failed', async (status) => {
    const t = delivery({ status }); await t.run({}, service);
    expect(t.rpc).toHaveBeenLastCalledWith('record_relationship_delivery_result', expect.objectContaining({ p_outcome: 'failed', p_retry_at: null }));
  });
  it('does not retry exhausted work', async () => {
    const t = delivery({ status: 503, attempt: 3 }); await t.run({}, service);
    expect(t.rpc).toHaveBeenLastCalledWith('record_relationship_delivery_result', expect.objectContaining({ p_outcome: 'failed', p_retry_at: null }));
  });
  it('records transport uncertainty for retry with stable provider idempotency', async () => {
    const t = delivery({ networkError: true }); await t.run({}, service);
    expect(t.rpc).toHaveBeenLastCalledWith('record_relationship_delivery_result', expect.objectContaining({ p_outcome: 'retry', p_error_code: 'network_error' }));
    const post = t.transport.mock.calls[0][1]!; expect((post.headers as Record<string, string>)['idempotency-key']).toBe(communication.providerIdempotencyKey);
  });
  it('suppression/preparation failure never sends and records work retry', async () => {
    const t = delivery({ prepareError: true }); await t.run({}, service); expect(t.transport).not.toHaveBeenCalled();
    expect(t.rpc).toHaveBeenLastCalledWith('record_relationship_campaign_work_result', expect.objectContaining({ p_outcome: 'retry', p_error_code: 'prepare_error' }));
  });
  it('threads a follow-up only to the resolved prior enrollment communication', async () => {
    const t = delivery({ reply: true }); await t.run({}, service);
    const post = t.transport.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(post[1]!.body as string)).toMatchObject({ subject: 'Re: Original subject', headers: { 'In-Reply-To': '<synthetic-root@example.invalid>', References: '<synthetic-root@example.invalid>' } });
    expect(t.queries.some((q) => q.filters.some(([key, value]) => key === 'enrollment_id' && value === 'enrollment'))).toBe(true);
  });
  it('refuses a new thread when the root message cannot be found', async () => {
    const t = delivery({ reply: true, rootMissing: true }); await t.run({}, service); expect(t.transport).not.toHaveBeenCalled();
    expect(t.rpc).toHaveBeenLastCalledWith('record_relationship_delivery_result', expect.objectContaining({ p_outcome: 'retry', p_error_code: 'thread_preparation_error' }));
  });
  it('reports result recording failure explicitly', async () => {
    const t = delivery({ recordingError: true }); const body = await (await t.run({}, service)).json();
    expect(body.results[0].outcome).toBe('result_failed');
  });
});
