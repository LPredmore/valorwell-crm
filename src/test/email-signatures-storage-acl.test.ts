import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Static regression contract for the email-signatures Storage ACL hardening
 * (GitHub issue #201). Source-only: asserts the staged forward-only SQL keeps
 * the exact safety shape reviewers approved. Runs offline; never connects to
 * Supabase. The operator-run catalog contract lives at
 * supabase/tests/email_signatures_storage_acl_contract.sql.
 */

const MIGRATION_PATH = resolve(
  __dirname,
  '../../supabase/verification/email_signatures_storage_acl_hardening.sql',
);
const CONTRACT_PATH = resolve(
  __dirname,
  '../../supabase/tests/email_signatures_storage_acl_contract.sql',
);

const sql = readFileSync(MIGRATION_PATH, 'utf8');
const contract = readFileSync(CONTRACT_PATH, 'utf8');

/** Strip `--` line comments so assertions match executable SQL only. */
const executable = sql
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

describe('email-signatures storage ACL hardening (issue #201)', () => {
  it('drops all three legacy bucket-wide policies by exact name', () => {
    for (const legacy of [
      'Authenticated users can upload signature images',
      'Authenticated users can delete signature images',
      'Anyone can view signature images',
    ]) {
      expect(executable).toContain(`DROP POLICY IF EXISTS "${legacy}" ON storage.objects;`);
    }
  });

  it('preserves public read on the publicly readable bucket', () => {
    expect(executable).toMatch(
      /CREATE POLICY email_signatures_public_select[\s\S]*?FOR SELECT TO PUBLIC[\s\S]*?USING \(bucket_id = 'email-signatures'\)/,
    );
  });

  it('creates capability-gated INSERT, UPDATE and DELETE policies TO authenticated', () => {
    for (const [name, cmd] of [
      ['email_signatures_crm_insert', 'FOR INSERT'],
      ['email_signatures_crm_update', 'FOR UPDATE'],
      ['email_signatures_crm_delete', 'FOR DELETE'],
    ] as const) {
      expect(executable).toMatch(new RegExp(`CREATE POLICY ${name}[\\s\\S]*?${cmd} TO authenticated`));
    }
  });

  it('gates every write on crm_user_capabilities admin/operator, never bucket_id alone', () => {
    const writePolicies = executable.match(/CREATE POLICY email_signatures_crm_\w+[\s\S]*?\);/g) ?? [];
    expect(writePolicies).toHaveLength(3);
    for (const policy of writePolicies) {
      expect(policy).toContain('public.crm_user_capabilities');
      expect(policy).toContain("'crm_admin'::public.crm_capability_role");
      expect(policy).toContain("'crm_operator'::public.crm_capability_role");
      expect(policy).toContain('(SELECT auth.uid())');
    }
  });

  it('UPDATE policy carries both USING and WITH CHECK capability predicates', () => {
    const update = executable.match(/CREATE POLICY email_signatures_crm_update[\s\S]*?\);/);
    expect(update).not.toBeNull();
    const body = update![0];
    expect(body).toMatch(/USING \([\s\S]*?crm_user_capabilities/);
    expect(body).toMatch(/WITH CHECK \([\s\S]*?crm_user_capabilities/);
  });

  it('grants no write policy TO PUBLIC or anon', () => {
    const writePolicies = executable.match(/CREATE POLICY \w+[\s\S]*?FOR (INSERT|UPDATE|DELETE)[\s\S]*?\);/g) ?? [];
    expect(writePolicies.length).toBeGreaterThan(0);
    for (const policy of writePolicies) {
      expect(policy).not.toMatch(/TO PUBLIC/i);
      expect(policy).not.toMatch(/TO anon/i);
    }
  });

  it('keeps flat legacy object paths working: no foldername() predicate on writes', () => {
    // A tenant-folder predicate would break the existing flat production
    // object and the current flat uuid.ext upload flow.
    expect(executable).not.toContain('storage.foldername');
  });

  it('touches no managed roles, grants, or other buckets', () => {
    expect(executable).not.toMatch(/GRANT|REVOKE/i);
    expect(executable).not.toContain('org-logos');
    expect(executable).not.toContain('training-covers');
    expect(executable).not.toContain('email-assets');
    expect(executable).not.toContain('profile-images');
    expect(executable).not.toContain('supabase_storage_admin');
  });

  it('operator catalog contract covers all six acceptance checks', () => {
    for (const check of [
      'legacy_policies_removed',
      'public_select_preserved',
      'insert_requires_crm_capability',
      'update_using_and_with_check',
      'delete_requires_crm_capability',
      'no_public_or_anon_write_policy',
    ]) {
      expect(contract).toContain(`'${check}'`);
    }
  });
});
