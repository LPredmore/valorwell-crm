// P09 static assertion tests — legacy pat_status must not leak into new surfaces.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx)$/.test(entry)) acc.push(full);
  }
  return acc;
}

const FILES = walk('src');

describe('P09 legacy authority assertions', () => {
  it('contract package exports CONTRACT_VERSION', async () => {
    const mod = await import('@/lib/crm/contracts');
    expect(mod.CONTRACT_VERSION).toBeTruthy();
    expect(mod.CANONICAL_READ_VIEW).toBe('v_client_canonical_state');
  });

  it('new canonical surfaces do not import status-config', () => {
    const violators = FILES
      .filter(f =>
        f.includes('/contracts/') ||
        f.endsWith('/CanonicalBadges.tsx') ||
        f.endsWith('/useCanonicalClientState.ts') ||
        f.endsWith('/useCanonicalMutations.ts') ||
        f.endsWith('/Reports.tsx'),
      )
      .filter(f => readFileSync(f, 'utf8').includes('status-config'));
    expect(violators).toEqual([]);
  });

  it('reports page does not read pat_status directly', () => {
    const content = readFileSync('src/pages/crm/Reports.tsx', 'utf8');
    expect(content).not.toMatch(/pat_status/);
  });
});
