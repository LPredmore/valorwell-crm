import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const sql = readFileSync('supabase/migrations/20261021184721_production_storage_tenant_boundary.sql', 'utf8').replace(/\r\n/g, '\n');
const uploader = readFileSync('src/components/crm/settings/EmailSignaturesPanel.tsx', 'utf8');
describe('production public asset authorization contract', () => {
  it('binds all four write predicates to trusted tenant, membership and capability', () => {
    expect(sql.match(/user_metadata->>'tenant_id' = auth.jwt\(\)->'app_metadata'->>'current_tenant_id'/g)).toHaveLength(4);
    expect(sql.match(/membership.profile_id = capability.profile_id/g)).toHaveLength(4);
    expect(sql.match(/membership.tenant_id = capability.tenant_id/g)).toHaveLength(4);
    expect(sql.match(/capability.crm_role::text IN \('crm_admin','crm_operator'\)/g)).toHaveLength(4);
    expect(sql).not.toContain('user_metadata()');
  });
  it('preserves public reads and existing untagged objects without guessing ownership', () => {
    expect(sql).not.toMatch(/FOR SELECT|UPDATE storage.objects|DELETE FROM storage.objects|DROP POLICY[^\n]*(Anyone|publicly accessible)/i);
    expect(sql).toContain('FOR UPDATE TO authenticated\nUSING');
    expect(sql).toContain('WITH CHECK');
  });
  it('uploads new signature images with selected tenant metadata', () => {
    expect(uploader).toContain('if (!file || !tenantId) return;');
    expect(uploader).toContain('.upload(path, file, { metadata: { tenant_id: tenantId } })');
  });
});
