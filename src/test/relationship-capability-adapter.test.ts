import { describe, expect, it } from 'vitest';
import { relationshipCapabilities } from '@/domain/relationships/capabilities';
import { CachedRelationshipCapabilityAdapter } from '@/services/relationships/capability-adapter';

describe('relationship capability adapter', () => {
  it('caches a single capability probe and fills missing contracts explicitly', async () => {
    let calls = 0;
    const adapter = new CachedRelationshipCapabilityAdapter({
      async capabilities() { calls += 1; return relationshipCapabilities({ organizations: 'available' }).slice(0, 1); },
    });
    expect((await adapter.get('organizations')).status).toBe('available');
    expect((await adapter.get('contacts')).status).toBe('missing_contract');
    expect(calls).toBe(1);
  });

  it('classifies a probe failure once without retrying unsupported capabilities', async () => {
    let calls = 0;
    const adapter = new CachedRelationshipCapabilityAdapter({
      async capabilities() { calls += 1; throw new Error('network fetch failed'); },
    });
    expect((await adapter.get('campaigns')).status).toBe('network_error');
    expect((await adapter.get('campaigns')).available).toBe(false);
    expect(calls).toBe(1);
  });

  it('invalidates only when a caller intentionally requests a fresh snapshot', async () => {
    let calls = 0;
    const adapter = new CachedRelationshipCapabilityAdapter({
      async capabilities() { calls += 1; return relationshipCapabilities(); },
    });
    await adapter.all();
    adapter.invalidate();
    await adapter.all();
    expect(calls).toBe(2);
  });
});
