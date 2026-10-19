// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { edgeRuntime } from './edge-worker-runtime';
import { publishHarness } from './helpers/publish-harness';
import { TENANT_A, TENANT_B } from './helpers/social-fixtures';

async function world(role = 'crm_operator', tenant = TENANT_A, authenticated = true) {
  const h = publishHarness();
  const id = await h.prepare('short', 'private', { skipQueue: true });
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => name === 'get_crm_operating_context' ? { data: { authenticated, current_tenant_id: tenant, profile_id: 'synthetic-user', crm_role: role, capabilities: { mutate: role === 'crm_admin' || role === 'crm_operator' } }, error: null } : h.db.rpc(name, args));
  const run = edgeRuntime('supabase/functions/social-media-manager/index.ts', {
    db: { from: h.db.from.bind(h.db), rpc },
    env: { SUPABASE_ANON_KEY: 'synthetic-anon' },
  });
  return { ...h, id, rpc, run };
}
const browser = { authorization: 'Bearer synthetic-browser' };
describe('actual Social Media HTTP auth → handler → internal queue (synthetic DB, no provider egress)', () => {
  it.each(['crm_operator', 'crm_admin'])('allows %s to queue owned approved publication without publishing', async (role) => {
    const h = await world(role); const response = await h.run({ action: 'queue_publish', id: h.id, tenantId: TENANT_B }, browser);
    expect(response.status).toBe(200); expect(h.jobsFor(h.id).filter((j) => j.job_type === 'publish_youtube')).toHaveLength(1);
    expect(h.pub(h.id).status).toBe('upload_queued'); expect(h.youtube.videos.size).toBe(0);
    expect(h.rpc).toHaveBeenCalledWith('social_queue_publish', { p_publication_id: h.id });
  });
  it('denies readonly before privileged queue RPC', async () => {
    const h = await world('crm_readonly'); expect((await h.run({ action: 'queue_publish', id: h.id }, browser)).status).toBe(403);
    expect(h.rpc.mock.calls.some(([name]) => name === 'social_queue_publish')).toBe(false); expect(h.pub(h.id).status).toBe('approved');
  });
  it('denies foreign ownership even if request body impersonates owning tenant', async () => {
    const h = await world('crm_operator', TENANT_B); const response = await h.run({ action: 'queue_publish', id: h.id, tenantId: TENANT_A }, browser);
    expect(response.status).toBe(500); expect((await response.json()).error).toBe('Publication not found');
    expect(h.rpc.mock.calls.some(([name]) => name === 'social_queue_publish')).toBe(false); expect(h.pub(h.id).status).toBe('approved');
  });
  it('denies unauthenticated context and bare requests', async () => {
    const h = await world('crm_operator', TENANT_A, false);
    expect((await h.run({ action: 'queue_publish', id: h.id }, browser)).status).toBe(401);
    expect((await h.run({ action: 'queue_publish', id: h.id })).status).toBe(401);
    expect(h.rpc.mock.calls.some(([name]) => name === 'social_queue_publish')).toBe(false);
  });
  it('rejects HTTP replay after first queue transition', async () => {
    const h = await world(); expect((await h.run({ action: 'queue_publish', id: h.id }, browser)).status).toBe(200);
    expect((await h.run({ action: 'queue_publish', id: h.id }, browser)).status).toBe(500);
    expect(h.jobsFor(h.id).filter((j) => j.job_type === 'publish_youtube')).toHaveLength(1); expect(h.youtube.videos.size).toBe(0);
  });
  it('rejects browser attempts to invoke internal cron dispatch', async () => {
    const h = await world(); const response = await h.run({ action: 'series_dispatch_tick' }, browser);
    expect(response.status).toBe(401); expect(h.youtube.videos.size).toBe(0);
  });
});
