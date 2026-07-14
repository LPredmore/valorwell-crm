// P09 static assertion tests — legacy pat_status writes and direct
// protected-column writes must not leak into CRM code paths.
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

const FILES = walk('src').filter(
  (f) =>
    !f.endsWith('src/integrations/supabase/types.ts') &&
    !f.includes('/test/'),
);

const PROTECTED_COLUMNS = [
  'pat_status',
  'assigned_therapist_id',
  'contact_policy',
  'service_policy',
  'care_cadence',
  'at_risk',
];

describe('P09 legacy authority assertions', () => {
  it('contract package exports CONTRACT_VERSION', async () => {
    const mod = await import('@/lib/crm/contracts');
    expect(mod.CONTRACT_VERSION).toBeTruthy();
    expect(mod.CANONICAL_READ_VIEW).toBe('v_client_canonical_state');
  });

  it('no direct .update({ pat_status }) or protected-column writes anywhere in src/', () => {
    const violators: Array<{ file: string; column: string }> = [];
    for (const file of FILES) {
      const content = readFileSync(file, 'utf8');
      // Match `.update({ ... <col>: ... })` style writes on the clients table.
      for (const col of PROTECTED_COLUMNS) {
        const re = new RegExp(`\\.update\\(\\s*\\{[^}]*\\b${col}\\b\\s*:`, 's');
        if (re.test(content)) violators.push({ file, column: col });
      }
    }
    expect(violators).toEqual([]);
  });

  it('canonical hook file does not read pat_status', () => {
    const content = readFileSync('src/hooks/crm/useCanonicalClientState.ts', 'utf8');
    expect(content).not.toMatch(/pat_status/);
  });

  it('canonical Reports page does not read pat_status directly', () => {
    const content = readFileSync('src/pages/crm/canonical/CanonicalReports.tsx', 'utf8');
    expect(content).not.toMatch(/pat_status/);
  });
});
