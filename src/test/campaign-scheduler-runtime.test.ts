// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { edgeRuntime } from './edge-worker-runtime';

const tenant = '00000000-0000-0000-0000-000000000001';
const campaign = { id: 'campaign', name: 'Synthetic', is_active: true, weekdays_only: false, send_window_start: '00:00', send_window_end: '24:00', default_timezone: 'UTC' };
const initial = { id: 'step-log', enrollment_id: 'enrollment', step_id: 'first-step', tenant_id: tenant, client_id: 'client', channel: 'email', claim_token: 'owned-lease' };
const first = { id: 'first-step', campaign_id: 'campaign', step_order: 1, channel: 'email', is_active: true, email_subject: 'Hello {{first_name}}', email_body_html: '<p>Synthetic for {{first_name}}</p>', email_body_text: null, email_editor_document: null };
function scheduler(options: { inactive?: boolean; cancelled?: boolean; denied?: boolean; foreignClient?: boolean; failedPolicy?: boolean; status?: number; completed?: boolean; lostLease?: boolean; outsideWindow?: boolean } = {}) {
  let claimed = false;
  const writes: { table: string; action: string; value: Record<string, unknown>; filters: [string, unknown][] }[] = [];
  const rpc = vi.fn(async (name: string) => {
    if (name === 'claim_pending_campaign_steps') { const items = claimed ? [] : [initial]; claimed = true; return { data: items, error: null }; }
    if (name === 'crm_evaluate_communication_policy') return options.failedPolicy ? { data: null, error: { message: 'synthetic failure' } } : { data: { allowed: !options.denied, reason_code: options.denied ? 'contact_policy_dnc' : 'ok', policy_version: 'synthetic' }, error: null };
    return { data: true, error: null };
  });
  const db = { rpc, from: (table: string) => {
    const filters: [string, unknown][] = []; let action = 'read'; let value = {};
    const result = () => {
      if (action !== 'read') {
        writes.push({ table, action, value, filters: [...filters] });
        if (table === 'crm_campaign_step_logs' && action === 'update') return { data: options.lostLease ? null : { id: 'step-log' }, error: null };
        return { data: { id: 'synthetic-message' }, error: null };
      }
      if (table === 'crm_campaign_enrollments') return { data: { id: 'enrollment', campaign_id: 'campaign', client_id: 'client', status: options.cancelled ? 'cancelled' : 'active', campaign: { ...campaign, is_active: !options.inactive, ...(options.outsideWindow ? { send_window_start: 'bad' } : {}) } }, error: null };
      if (table === 'clients') return { data: { id: 'client', tenant_id: options.foreignClient ? 'foreign-tenant' : tenant, email: 'synthetic@example.invalid', pat_name_f: 'Synthetic', pat_time_zone: 'UTC' }, error: null };
      if (table === 'crm_campaign_steps') return { data: filters.some(([key]) => key === 'campaign_id') ? options.completed ? [first] : [first, { id: 'next-step', step_order: 2, delay_days: 1, channel: 'email' }] : first, error: null };
      if (table === 'crm_resend_email_settings') return { data: { from_email: 'sender@example.invalid', from_name: 'Synthetic', inbound_email: 'inbound@example.invalid', connection_status: 'connected' }, error: null };
      return { data: null, error: null };
    };
    const chain = { select: () => chain, eq: (key: string, val: unknown) => { filters.push([key, val]); return chain; }, order: () => chain, insert: (val: Record<string, unknown>) => { action = 'insert'; value = val; return chain; }, update: (val: Record<string, unknown>) => { action = 'update'; value = val; return chain; }, single: async () => result(), maybeSingle: async () => result(), then: (resolve: (value: unknown) => void) => Promise.resolve(result()).then(resolve) };
    return chain;
  } };
  const transport = vi.fn(async () => Response.json(options.status && options.status !== 200 ? { message: 'Synthetic provider rejection' } : { id: 'synthetic-provider' }, { status: options.status ?? 200 }));
  return { rpc, writes, transport, run: edgeRuntime('supabase/functions/campaign-scheduler/index.ts', { db, fetch: transport as typeof fetch }) };
}
const auth = { 'x-cron-secret': 'synthetic-cron' };
describe('actual campaign scheduler orchestration with synthetic database adapter', () => {
  it('rejects browser authorization before claiming or sending', async () => {
    const h = scheduler(); expect((await h.run({}, { authorization: 'Bearer browser' })).status).toBe(401); expect(h.rpc).not.toHaveBeenCalled(); expect(h.transport).not.toHaveBeenCalled();
  });
  it('renders, records associations, sends, finalizes owned lease, audits and schedules next step', async () => {
    const h = scheduler(); const body = await (await h.run({}, auth)).json();
    expect(body.campaigns).toMatchObject({ sent: 1, failed: 0 }); expect(h.transport).toHaveBeenCalledTimes(1);
    expect(h.writes).toContainEqual(expect.objectContaining({ table: 'crm_email_messages', action: 'insert', value: expect.objectContaining({ tenant_id: tenant, client_id: 'client', enrollment_id: 'enrollment', step_log_id: 'step-log', subject: 'Hello Synthetic' }) }));
    expect(h.writes).toContainEqual(expect.objectContaining({ table: 'crm_campaign_step_logs', action: 'update', filters: [['id', 'step-log'], ['status', 'processing'], ['claim_token', 'owned-lease']] }));
    expect(h.writes).toContainEqual(expect.objectContaining({ table: 'crm_activity_events', value: expect.objectContaining({ event_type: 'email_sent', tenant_id: tenant, client_id: 'client' }) }));
    expect(h.writes).toContainEqual(expect.objectContaining({ table: 'crm_campaign_step_logs', action: 'insert', value: expect.objectContaining({ step_id: 'next-step', status: 'scheduled', tenant_id: tenant, scheduled_for: expect.any(String) }) }));
  });
  it('completes the enrollment after the final step', async () => {
    const h = scheduler({ completed: true }); await h.run({}, auth);
    expect(h.writes).toContainEqual(expect.objectContaining({ table: 'crm_campaign_enrollments', value: expect.objectContaining({ status: 'completed' }) }));
  });
  it.each([{ cancelled: true }, { inactive: true }])('does not send inactive work %j', async (options) => {
    const h = scheduler(options); await h.run({}, auth); expect(h.transport).not.toHaveBeenCalled();
    expect(h.rpc).toHaveBeenCalledWith('release_campaign_step_claim', expect.objectContaining({ p_status: 'skipped', p_claim_token: 'owned-lease' }));
  });
  it.each([{ denied: true }, { foreignClient: true }, { failedPolicy: true }])('fails closed at actual suppression evaluator %j', async (options) => {
    const h = scheduler(options); await h.run({}, auth); expect(h.transport).not.toHaveBeenCalled();
    expect(h.rpc).toHaveBeenCalledWith('release_campaign_step_claim', expect.objectContaining({ p_status: 'suppressed', p_claim_token: 'owned-lease' }));
    if (options.denied) expect(h.writes).toContainEqual(expect.objectContaining({ table: 'crm_activity_events', value: expect.objectContaining({ event_type: 'email_suppressed' }) }));
  });
  it('reschedules outside the campaign window without sending', async () => {
    const h = scheduler({ outsideWindow: true }); await h.run({}, auth); expect(h.transport).not.toHaveBeenCalled();
    expect(h.rpc).toHaveBeenCalledWith('release_campaign_step_claim', expect.objectContaining({ p_status: 'scheduled', p_reason: 'outside_send_window', p_next_scheduled_for: expect.any(String) }));
  });
  it('records rejected provider result and releases the lease as failed', async () => {
    const h = scheduler({ status: 503 }); await h.run({}, auth);
    expect(h.rpc).toHaveBeenCalledWith('release_campaign_step_claim', expect.objectContaining({ p_status: 'failed' }));
    expect(h.writes).toContainEqual(expect.objectContaining({ table: 'crm_email_messages', value: expect.objectContaining({ status: 'failed' }) }));
    expect(h.writes.some((write) => write.table === 'crm_campaign_step_logs' && write.action === 'insert')).toBe(false);
  });
  it('does not schedule or audit a send when the lease finalization lost ownership', async () => {
    const h = scheduler({ lostLease: true }); await h.run({}, auth);
    expect(h.writes.some((write) => write.table === 'crm_campaign_step_logs' && write.action === 'insert')).toBe(false);
    expect(h.writes.some((write) => write.table === 'crm_activity_events' && write.value.event_type === 'email_sent')).toBe(false);
  });
  it('executes duplicate HTTP ticks concurrently without an additional mocked claimed delivery', async () => {
    const h = scheduler(); await Promise.all([h.run({}, auth), h.run({}, auth)]); expect(h.transport).toHaveBeenCalledTimes(1);
    // Claim exclusion here is synthetic; real SKIP LOCKED/lease acceptance remains a database test.
  });
});
