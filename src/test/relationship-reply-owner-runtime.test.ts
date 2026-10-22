// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
let db: PGlite;
const tenant = '00000000-0000-0000-0000-000000000001';
const other = '00000000-0000-0000-0000-000000000002';
const owner = '00000000-0000-0000-0000-000000000003';
const org = '00000000-0000-0000-0000-000000000004';
const opportunity = '00000000-0000-0000-0000-000000000005';
beforeAll(async () => {
  db = new PGlite();
  // Minimal dependency tables, actual deployed trigger body; no provider or network.
  await db.exec(`create schema private;
    create table public.relationship_opportunities(id uuid, tenant_id uuid, organization_id uuid, owner_profile_id uuid);
    create table public.relationship_replies(id uuid default gen_random_uuid(), tenant_id uuid, opportunity_id uuid, organization_id uuid, owner_profile_id uuid, metadata jsonb, follow_up_due_at timestamptz);`);
  await db.exec(readFileSync('supabase/migrations/20261021220125_reply_ownership.sql', 'utf8'));
  await db.query('insert into relationship_opportunities values ($1,$2,$3,$4)', [opportunity, tenant, org, owner]);
}, 60_000);
afterAll(async () => db?.close());
describe('actual reply owner trigger in isolated Postgres', () => {
  it.each([
    ['same tenant', tenant, opportunity, org, owner],
    ['missing opportunity', tenant, null, org, null],
    ['unknown opportunity', tenant, other, org, null],
    ['foreign tenant', other, opportunity, org, null],
    ['mismatched organization', tenant, opportunity, other, null],
  ])('%s never trusts a supplied owner or invents a deadline', async (_, tenantId, opportunityId, organizationId, expected) => {
    const { rows } = await db.query<{ owner_profile_id: string | null; metadata: Record<string, unknown>; follow_up_due_at: null }>('insert into relationship_replies(tenant_id,opportunity_id,organization_id,owner_profile_id,metadata) values ($1,$2,$3,$4,$5) returning *', [tenantId, opportunityId, organizationId, other, { owner_review_required: true }]);
    expect(rows[0].owner_profile_id).toBe(expected);
    expect(rows[0].metadata.owner_review_required).toBe(expected ? undefined : true);
    expect(rows[0].follow_up_due_at).toBeNull();
  });
  it('requires review if the verified opportunity has no owner', async () => {
    await db.query('update relationship_opportunities set owner_profile_id=null where id=$1', [opportunity]);
    const { rows } = await db.query<{ owner_profile_id: null; metadata: Record<string, unknown> }>('insert into relationship_replies(tenant_id,opportunity_id,organization_id) values ($1,$2,$3) returning *', [tenant, opportunity, org]);
    expect(rows[0].owner_profile_id).toBeNull();
    expect(rows[0].metadata.owner_review_required).toBe(true);
  });
});
