// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const t1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const t2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const alice = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const outsider = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const c1 = '00000000-0000-4000-8000-000000000001';
const c2 = '00000000-0000-4000-8000-000000000002';
const c3 = '00000000-0000-4000-8000-000000000003';
const app1 = '00000000-0000-4000-8000-000000000004';
const client1 = '00000000-0000-4000-8000-000000000005';
const prospect = '00000000-0000-4000-8000-000000000007';
const foreignProspect = '00000000-0000-4000-8000-000000000008';
const roleInbox = '00000000-0000-4000-8000-000000000009';
const operator = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const readonlyUser = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const nonClinicalAdmin = '11111111-1111-4111-8111-111111111111';
const opportunity = '00000000-0000-4000-8000-000000000006';

const schema = `
create role anon;
create role authenticated;
create role service_role;
create schema auth;
create schema private;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table public.tenants(id uuid primary key);
create table public.relationship_contacts(id uuid primary key, tenant_id uuid not null, preferred_name text, first_name text, last_name text);
create table public.relationship_opportunities(id uuid primary key, tenant_id uuid not null, primary_contact_id uuid);
create table public.provider_applicants(id uuid primary key, tenant_id uuid not null);
create table public.clients(id uuid primary key, tenant_id uuid not null);
create table public.therapist_outreach_prospects(id uuid primary key, tenant_id uuid not null);
create table public._identity_test_roles(user_id uuid, tenant_id uuid, crm_role text, clinical_admin boolean not null default false);
create function private.crm_has_relationship_permission(p_user_id uuid, p_tenant uuid, p_permission text)
  returns boolean language sql stable security definer set search_path = ''
  as $$ select p_user_id = auth.uid() and exists (
    select 1 from public._identity_test_roles r
      where r.user_id = p_user_id and r.tenant_id = p_tenant
      and case when p_permission = 'view_sensitive_evidence' then r.crm_role = 'crm_admin'
      when p_permission = 'edit_relationships' then r.crm_role in ('crm_admin', 'crm_operator')
      when p_permission = 'view_relationships' then r.crm_role in ('crm_admin', 'crm_operator', 'crm_readonly')
      else false end
  ) $$;
create function public.crm_has_role(p_user_id uuid, p_roles text[], p_tenant uuid)
  returns boolean language sql stable security definer set search_path = ''
  as $$ select p_user_id = auth.uid() and
    exists(select 1 from public._identity_test_roles r where r.user_id = p_user_id
      and r.tenant_id = p_tenant and r.clinical_admin) $$;
grant usage on schema auth, private to authenticated;
grant execute on function auth.uid() to authenticated;
grant execute on function private.crm_has_relationship_permission(uuid,uuid,text) to authenticated;
grant execute on function public.crm_has_role(uuid,text[],uuid) to authenticated;
insert into public.tenants values ('${t1}'), ('${t2}');
insert into public.relationship_contacts(id,tenant_id,first_name) values ('${c1}', '${t1}', 'Alex'), ('${c2}', '${t1}', 'Morgan'), ('${c3}', '${t2}', 'Taylor'), ('${roleInbox}', '${t1}', null);
insert into public.provider_applicants values ('${app1}', '${t1}');
insert into public.clients values ('${client1}', '${t1}');
insert into public.relationship_opportunities values ('${opportunity}', '${t1}', '${c1}');
insert into public.therapist_outreach_prospects values ('${prospect}', '${t1}'), ('${foreignProspect}', '${t2}');
insert into public._identity_test_roles values ('${alice}', '${t1}', 'crm_admin', true), ('${operator}', '${t1}', 'crm_operator', false), ('${readonlyUser}', '${t1}', 'crm_readonly', false), ('${nonClinicalAdmin}', '${t1}', 'crm_admin', false);
`;

describe('migration DDL and RLS integrity against embedded Postgres (not real signed JWT)', () => {
  it.each(['standalone', 'historical-plus-forward'] as const)('%s enforces current tenant access, source lifecycle and immutable event audit', async (sequence) => {
    const db = new PGlite();
    try {
      const fixtureStatements = schema.split(/;\s*\n/).map(s => s.trim()).filter(Boolean);
      for (const statement of fixtureStatements) {
        try { await db.exec(statement + ';'); }
        catch (error) { throw new Error('Fixture DDL failed at ' + statement.slice(0, 140) + ': ' + String(error)); }
      }
      if (sequence === 'historical-plus-forward') {
        await db.exec(readFileSync(resolve(process.cwd(), 'supabase/migrations/20261008161000_crm_identity_review_links.sql'), 'utf8'));
      }
      const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261015015000_crm_identity_review_links_current_tenants.sql'), 'utf8');
      try { await db.exec(migration); } catch (error) { throw new Error('Migration DDL failed: ' + String(error)); }

      await db.exec("set role authenticated");
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [alice]);

      // Reverse-order contact pairing must normalize to one source anchor.
      const review = await db.query<{ id: string; contact_id: string; linked_record_id: string }>(
        `insert into public.crm_identity_reviews(tenant_id,contact_id,linked_domain,linked_record_id,decision,match_basis,reviewed_by)
         values ($1,$2,'relationship_contact',$3,'linked','email',$4)
         returning id,contact_id,linked_record_id`, [t1,c2,c1,alice],
      );
      const id = review.rows[0].id;
      expect(review.rows[0]).toMatchObject({ contact_id: c1, linked_record_id: c2 });

      const events = await db.query<{ next_decision: string }>(
        'select next_decision from public.crm_identity_review_events where review_id = $1', [id],
      );
      expect(events.rows.map(r => r.next_decision)).toEqual(['linked']);

      await db.query(
        `update public.crm_identity_reviews set decision='rejected',reviewed_by=$2 where id=$1`,[id,alice],
      );
      const history = await db.query<{ next_decision: string }>(
        'select next_decision from public.crm_identity_review_events where review_id=$1 order by changed_at, id',[id],
      );
      expect(history.rows.map(r=>r.next_decision).sort()).toEqual(['linked','rejected']);

      // Cannot change source record IDs after review, or write into other tenant's sources.
      await expect(db.query(
        'update public.crm_identity_reviews set contact_id=$2 where id=$1',[id,c3],
      )).rejects.toThrow(/immutable/);
      await expect(db.query(
        `insert into public.crm_identity_reviews(tenant_id,contact_id,linked_domain,linked_record_id,decision,match_basis,reviewed_by)
         values($1,$2,'relationship_contact',$3,'linked','manual',$4)`,[t1,c1,c3,alice],
      )).rejects.toThrow(/unavailable|authorized/);
      await expect(db.query(
        `insert into public.crm_identity_reviews(tenant_id,contact_id,linked_domain,linked_record_id,decision,match_basis,reviewed_by)
         values($1,$2,'bty_opportunity',$3,'linked','manual',$4)`,[t1,c2,opportunity,alice],
      )).rejects.toThrow(/unavailable|authorized/);

      // Clinical sources remain references only. A valid admin link must not
      // contain client clinical data, and a wrong-tenant target must be rejected.
      await db.query(
        `insert into public.crm_identity_reviews(tenant_id,contact_id,linked_domain,linked_record_id,decision,match_basis,reviewed_by)
         values($1,$2,'client',$3,'linked','manual',$4)`,[t1,c1,client1,alice],
      );
      const clinical = await db.query('select * from public.crm_identity_reviews where linked_domain = $1',['client']);
      expect(clinical.rows).toHaveLength(1);
      expect(Object.keys(clinical.rows[0] as object)).not.toContain('diagnosis');

      // A source's actual tenant, not a separate attestation, controls prospect links.
      const insertLink = (domain: string, target: string, actor = alice) => db.query<{ id: string }>(
        `insert into public.crm_identity_reviews(tenant_id,contact_id,linked_domain,linked_record_id,decision,match_basis,reviewed_by)
         values($1,$2,$3,$4,'linked','manual',$5) returning id`, [t1,c1,domain,target,actor]);
      const prospectReview = await insertLink('therapist_prospect', prospect);
      await expect(insertLink('therapist_prospect', foreignProspect)).rejects.toThrow(/unavailable|authorized/);
      await expect(insertLink('relationship_contact', roleInbox)).rejects.toThrow(/unavailable|authorized/);
      await expect(insertLink('provider_applicant', app1, outsider)).rejects.toThrow(/authorized/);
      const bty = await insertLink('bty_opportunity', opportunity);

      // Exact retries do not invent extra evidence events; evidence changes do.
      const before = await db.query('select * from public.crm_identity_review_events where review_id=$1', [id]);
      await db.query("update public.crm_identity_reviews set decision='rejected',reviewed_by=$2 where id=$1", [id,alice]);
      expect((await db.query('select * from public.crm_identity_review_events where review_id=$1', [id])).rows).toHaveLength(before.rows.length);
      await db.query("update public.crm_identity_reviews set review_note='Independently confirmed evidence' where id=$1", [id]);
      const evidence = await db.query<{ previous_review_note: string | null; next_review_note: string }>(
        'select * from public.crm_identity_review_events where review_id=$1 order by changed_at desc,id desc', [id]);
      expect(evidence.rows).toHaveLength(before.rows.length + 1);
      expect(evidence.rows.some(e => e.previous_review_note === null && e.next_review_note === 'Independently confirmed evidence')).toBe(true);
      await expect(db.query('delete from public.crm_identity_reviews where id=$1', [id])).rejects.toThrow(/permission/);
      await expect(db.query('update public.crm_identity_review_events set next_decision=$1', ['linked'])).rejects.toThrow(/permission/);
      await expect(db.query('select * from public.provider_applicants')).rejects.toThrow(/permission/);
      await expect(db.query('select * from public.therapist_outreach_prospects')).rejects.toThrow(/permission/);

      // Business roles cannot read sensitive UUIDs; a CRM admin still needs clinical access.
      for (const actor of [operator, readonlyUser, nonClinicalAdmin]) {
        await db.query("select set_config('request.jwt.claim.sub', $1, false)", [actor]);
        expect((await db.query("select * from public.crm_identity_reviews where linked_domain='client'")).rows).toHaveLength(0);
        if (actor !== nonClinicalAdmin) {
          expect((await db.query("select * from public.crm_identity_reviews where linked_domain='therapist_prospect'")).rows).toHaveLength(0);
          await expect(insertLink('provider_applicant', app1, actor)).rejects.toThrow(/authorized|unavailable/);
        }
        if (actor === readonlyUser) {
          expect((await db.query("update public.crm_identity_reviews set decision='linked',reviewed_by=$2 where id=$1 returning id", [id,actor])).rows).toHaveLength(0);
        }
      }
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [alice]);

      // Owner-side source operations simulate lifecycle changes; no source FK may block them.
      await db.exec('reset role');
      await expect(db.query(`insert into public.crm_identity_review_events(review_id,tenant_id,next_decision,actor_id)
        values($1,$2,'linked',$3)`, [id,t2,alice])).rejects.toThrow(/foreign key/);
      await db.query('update public.therapist_outreach_prospects set tenant_id=$2 where id=$1', [prospect,t2]);
      await db.query('update public.relationship_opportunities set primary_contact_id=$2 where id=$1', [opportunity,c2]);
      await db.exec('set role authenticated');
      expect((await db.query('select * from public.crm_identity_reviews where id=$1', [prospectReview.rows[0].id])).rows).toHaveLength(0);
      expect((await db.query('select * from public.crm_identity_reviews where id=$1', [bty.rows[0].id])).rows).toHaveLength(0);
      expect((await db.query('select * from public.crm_identity_review_events where review_id=$1', [prospectReview.rows[0].id])).rows).toHaveLength(0);
      await db.exec('reset role');
      await db.query('delete from public.relationship_contacts where id=$1', [c2]);
      await db.exec('set role authenticated');
      expect((await db.query('select * from public.crm_identity_reviews where id=$1', [id])).rows).toHaveLength(0);
      expect((await db.query('select * from public.crm_identity_review_events where review_id=$1', [id])).rows).toHaveLength(0);

      // No actor permissions in tenant B; and unauthenticated reads are denied.
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [outsider]);
      const unauthorized = await db.query('select * from public.crm_identity_reviews');
      expect(unauthorized.rows).toHaveLength(0);
      await expect(db.query(
        `insert into public.crm_identity_reviews(tenant_id,contact_id,linked_domain,linked_record_id,decision,match_basis,reviewed_by)
         values($1,$2,'relationship_contact',$3,'linked','manual',$4)`,[t1,c1,c2,outsider],
      )).rejects.toThrow(/row-level security|permission|authorized/i);
    } finally {
      await db.close();
    }
  }, 60000);
});
