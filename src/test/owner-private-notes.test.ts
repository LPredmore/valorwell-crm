import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const rpcMock = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: (...a: unknown[]) => rpcMock(...a) } }));

import { ownerPrivateNotesEnabled, getOwnerPrivateNote, hasOwnerPrivateNoteAccess, ownerNoteQueryKey } from '@/repositories/supabase/ownerPrivateNotes';

const SQL = readFileSync('supabase/staged-migrations/20261021194000_crm_owner_private_applicant_notes.sql', 'utf8');
const OWNER = 'd2dc0624-1e71-49d6-8b04-76cf1e822074';
const TENANT = '00000000-0000-0000-0000-000000000001';

describe('owner private note flag', () => {
  it('is off unless explicitly "true"', () => {
    expect(ownerPrivateNotesEnabled({})).toBe(false);
    expect(ownerPrivateNotesEnabled({ VITE_CRM_OWNER_PRIVATE_NOTES: '1' })).toBe(false);
    expect(ownerPrivateNotesEnabled({ VITE_CRM_OWNER_PRIVATE_NOTES: 'true' })).toBe(true);
  });
});

describe('client never distinguishes denial from absence', () => {
  beforeEach(() => rpcMock.mockReset());
  it('denied RPC error yields null note and no access', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'not available' } });
    expect(await getOwnerPrivateNote(TENANT, 'x')).toBeNull();
    expect(await hasOwnerPrivateNoteAccess(TENANT, 'x')).toBe(false);
  });
  it('empty set yields null', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    expect(await getOwnerPrivateNote(TENANT, 'x')).toBeNull();
  });
  it('query key is scoped per user and tenant', () => {
    expect(ownerNoteQueryKey('a', TENANT, 's')).not.toEqual(ownerNoteQueryKey('b', TENANT, 's'));
  });
});

describe('staged SQL contract', () => {
  it('allowlists exactly one profile in one tenant, not a role', () => {
    const inserts = SQL.match(/insert into private\.crm_owner_note_allowlist[\s\S]*?;/g) ?? [];
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toContain(OWNER);
    expect(inserts[0]).toContain(TENANT);
    expect(SQL).not.toMatch(/tenant_role\s*=\s*'owner'/);
    expect(SQL).not.toMatch(/crm_admin/);
  });
  it('gate requires auth.uid() equals allowlisted profile, same tenant and submission tenant', () => {
    expect(SQL).toMatch(/a\.tenant_id = p_tenant and a\.profile_id = auth\.uid\(\)/);
    expect(SQL).toMatch(/s\.id = p_submission and s\.tenant_id = p_tenant/);
  });
  it('tables live in private schema, RLS on, no policies, all grants revoked incl. service_role', () => {
    for (const t of ['crm_owner_note_allowlist', 'crm_owner_applicant_notes', 'crm_owner_applicant_note_audit']) {
      expect(SQL).toContain(`create table private.${t}`);
      expect(SQL).toContain(`alter table private.${t} enable row level security`);
      expect(SQL).toContain(`revoke all on table private.${t} from public, anon, authenticated, service_role`);
    }
    expect(SQL).not.toMatch(/create policy/i);
    expect(SQL).not.toMatch(/grant [^;]* on table/i);
  });
  it('every definer function pins search_path and public RPCs deny anon/service_role', () => {
    const defs = SQL.match(/security definer[^$]*/g) ?? [];
    expect(defs.length).toBe(5);
    for (const d of defs) expect(d).toContain("set search_path = ''");
    for (const f of ['crm_owner_note_access', 'crm_owner_note_get', 'crm_owner_note_upsert', 'crm_owner_note_delete']) {
      expect(SQL).toMatch(new RegExp(`revoke all on function public\\.${f}\\([^)]*\\) from public, anon, service_role`));
    }
    expect(SQL).not.toMatch(/to anon|to service_role/);
  });
  it('updates are version-guarded and denials raise 42501', () => {
    expect(SQL).toMatch(/n\.version = p_expected_version/);
    expect((SQL.match(/errcode = '42501'/g) ?? []).length).toBe(2);
  });
  it('never touches shared or broadly readable tables', () => {
    expect(SQL).not.toMatch(/(insert into|update|alter table|delete from)\s+public\.(provider_applicants|crm_notes|crm_activity_events|provider_applicant_activity_events|website_submissions)/i);
    expect(SQL).not.toMatch(/application_data/);
  });
});

describe('source isolation', () => {
  const files: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : files.push(p); } };
  walk('src'); walk('supabase/functions');
  it('note RPCs are referenced only by the owner repository', () => {
    const users = files.filter(f => !f.endsWith('owner-private-notes.test.ts') && /crm_owner_note_/.test(readFileSync(f, 'utf8')));
    expect(users).toEqual([join('src/repositories/supabase/ownerPrivateNotes.ts')]);
  });
  it('the private table is not used by edge functions', () => {
    const users = files.filter(f => f.startsWith('supabase') && /crm_owner_applicant_notes/.test(readFileSync(f, 'utf8')));
    expect(users).toEqual([]);
  });
});
