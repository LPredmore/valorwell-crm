// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const tenantA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const tenantB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const operator = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const outsider = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const contactA = '00000000-0000-4000-8000-000000000001';
const contactB = '00000000-0000-4000-8000-000000000002';
const organizationA = '00000000-0000-4000-8000-000000000003';
const clientA = '00000000-0000-4000-8000-000000000004';
const taskA = '00000000-0000-4000-8000-000000000005';

const fixture = `
create role authenticated;
create role anon;
create schema auth;
create schema private;
create function auth.uid() returns uuid language sql stable as
  $body$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $body$;
create table public.relationship_contacts(id uuid primary key, tenant_id uuid not null);
create table public.relationship_organizations(id uuid primary key, tenant_id uuid not null);
create table public.crm_tasks(
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, title text not null,
 client_id uuid, staff_id uuid, campaign_id uuid, exception_id uuid, owner_id uuid,
 created_by_profile_id uuid not null, due_at timestamptz
);
create table public.identity_fixture_memberships(user_id uuid, tenant_id uuid, role text);
create table public.tenant_memberships(profile_id uuid, tenant_id uuid);
create function private.crm_has_relationship_permission(p_user uuid, p_tenant uuid, p_perm text)
returns boolean language sql stable security definer set search_path = ''
as $body$ select p_user = auth.uid() and exists (
 select 1 from public.identity_fixture_memberships t where t.user_id=p_user and t.tenant_id=p_tenant
 and (t.role='crm_admin' or (t.role='crm_operator' and p_perm <> 'view_sensitive_evidence'))
) $body$;
grant usage on schema private, auth to authenticated;
grant execute on function auth.uid() to authenticated;
grant execute on function private.crm_has_relationship_permission(uuid,uuid,text) to authenticated;
grant select,insert,update on public.crm_tasks to authenticated;
alter table public.crm_tasks enable row level security;
insert into public.identity_fixture_memberships values ('${operator}','${tenantA}','crm_operator');
insert into public.tenant_memberships values ('${operator}','${tenantA}');
insert into public.relationship_contacts values ('${contactA}','${tenantA}'), ('${contactB}','${tenantB}');
insert into public.relationship_organizations values ('${organizationA}','${tenantA}');
`;

describe('CRM relationship task schema in embedded PostgreSQL (not signed JWT)', () => {
  it('links canonical tasks atomically; blocks wrong-tenant links, clinical fields and unauthorized reads', async () => {
    const db = new PGlite();
    try {
      await db.exec(fixture);
      const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261008220000_crm_relationship_task_subjects.sql'), 'utf8');
      await db.exec(migration);
      await db.exec('set role authenticated');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [operator]);
      const inserted = await db.query<{ id: string }>(`
        insert into public.crm_tasks(id,tenant_id,title,created_by_profile_id,relationship_contact_id)
        values ($1,$2,'Call guest',$3,$4) returning id
      `,[taskA,tenantA,operator,contactA]);
      expect(inserted.rows[0].id).toBe(taskA);
      const visible = await db.query<{ id: string }>('select id from public.crm_tasks');
      expect(visible.rows.map(x=>x.id)).toEqual([taskA]);
      // Legal task status/owner adjustments cannot remove source provenance.
      await db.query('update public.crm_tasks set due_at=now() where id=$1',[taskA]);
      await expect(db.query('update public.crm_tasks set relationship_contact_id=$2 where id=$1',[taskA,contactB]))
        .rejects.toThrow(/tenant|immutable/);
      await expect(db.query('update public.crm_tasks set client_id=$2 where id=$1',[taskA,clientA]))
        .rejects.toThrow(/clinical|check constraint|exclusion/);
      await expect(db.query(`
        insert into public.crm_tasks(tenant_id,title,created_by_profile_id,relationship_contact_id)
        values ($1,'Other tenant',$2,$3)
      `,[tenantA,operator,contactB])).rejects.toThrow(/tenant/);
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [outsider]);
      expect((await db.query('select id from public.crm_tasks')).rows).toEqual([]);
      await expect(db.query(`
        insert into public.crm_tasks(tenant_id,title,created_by_profile_id,relationship_contact_id)
        values ($1,'Unowned',$2,$3)
      `,[tenantA,outsider,contactA])).rejects.toThrow(/row-level security|permission/i);
    } finally { await db.close(); }
  },60000);
});
