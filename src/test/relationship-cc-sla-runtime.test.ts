// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';

const TENANT='00000000-0000-0000-0000-000000000001';
const ORG_A='00000000-0000-0000-0000-000000000011';
const ORG_B='00000000-0000-0000-0000-000000000022';
const CONTACT_B='00000000-0000-0000-0000-000000000033';
const OPP_B='00000000-0000-0000-0000-000000000044';
const COMM='00000000-0000-0000-0000-000000000055';

describe('verified Gmail CC organization interactions',()=>{
  let db:PGlite;
  beforeAll(async()=>{
    db=new PGlite();
    await db.exec(`
      create schema private;
      create role anon; create role authenticated; create role service_role;
      create function private.relationship_header_value(h jsonb,k text)
        returns text language sql immutable as $$select h->>k$$;
      create table relationship_communications(
        id uuid primary key,tenant_id uuid,direction text,provider text,
        recipient_email text,organization_id uuid,occurred_at timestamptz,provider_message_id text default 'message',provider_thread_id text default 'thread');
      create table relationship_reconciliation_issues(tenant_id uuid,issue_type text,source text,external_event_id text,summary text,details jsonb,status text default 'open',updated_at timestamptz);
      create unique index open_issue on relationship_reconciliation_issues(tenant_id,issue_type,source,external_event_id) where status='open' and external_event_id is not null;
      create table relationship_contacts(id uuid,tenant_id uuid,email text);
      create table relationship_contact_organizations(
        tenant_id uuid,contact_id uuid,organization_id uuid);
      create table relationship_opportunities(
        id uuid,tenant_id uuid,organization_id uuid,primary_contact_id uuid,status text);
      create table relationship_interactions(
        id uuid primary key default gen_random_uuid(),tenant_id uuid,organization_id uuid,
        contact_id uuid,opportunity_id uuid,interaction_type text,occurred_at timestamptz,
        summary text,metadata jsonb);
    `);
    const sql=readFileSync('supabase/migrations/20261022200829_relationship_secondary_to_recipients.sql','utf8');
    await db.exec(sql);
  },60_000);
  afterAll(async()=>db?.close());
  beforeEach(async()=>{
    await db.exec('truncate relationship_reconciliation_issues,relationship_communications, relationship_contacts, relationship_contact_organizations,relationship_opportunities,relationship_interactions');
    await db.query('insert into relationship_communications(id,tenant_id,direction,provider,recipient_email,organization_id,occurred_at) values ($1,$2,$3,$4,$5,$6,now())',
      [COMM,TENANT,'outbound','gmail','primary@example.invalid',ORG_A]);
    await db.query('insert into relationship_contacts values ($1,$2,$3)',
      [CONTACT_B,TENANT,'guest@example.invalid']);
    await db.query('insert into relationship_contact_organizations values ($1,$2,$3)',
      [TENANT,CONTACT_B,ORG_B]);
    await db.query('insert into relationship_opportunities values ($1,$2,$3,$4,$5)',
      [OPP_B,TENANT,ORG_B,CONTACT_B,'interested']);
  });
  async function run(cc:string) {
    const x=await db.query<{n:number}>(
      'select private.record_cc_relationship_interactions_v1($1,$2,$3::jsonb) as n',
      [TENANT,COMM,JSON.stringify({cc})]);
    return x.rows[0].n;
  }
  it('records a secondary To organization once even when also CCed',async()=>{
    const headers={to:'primary@example.invalid, guest@example.invalid',cc:'guest@example.invalid'};
    const q='select private.record_cc_relationship_interactions_v1($1,$2,$3::jsonb) as n';
    expect((await db.query<{n:number}>(q,[TENANT,COMM,JSON.stringify(headers)])).rows[0].n).toBe(1);
    expect((await db.query<{n:number}>(q,[TENANT,COMM,JSON.stringify(headers)])).rows[0].n).toBe(0);
    expect((await db.query<{role:string}>("select metadata->>'recipient_role' role from relationship_interactions")).rows[0].role).toBe('to');
  });
  it('retains unknown secondary recipients as idempotent review exceptions',async()=>{
    expect(await run('unknown@example.invalid')).toBe(0);
    expect(await run('unknown@example.invalid')).toBe(0);
    const result=await db.query<{details:{recipient_review:Record<string,string>}}>('select details from relationship_reconciliation_issues');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].details.recipient_review).toEqual({'unknown@example.invalid':'cc'});
  });
  it('creates exactly one secondary interaction, no second physical email, without changing opportunity',async()=>{
    expect(await run('Guest <guest@example.invalid>')).toBe(1);
    expect(await run('Guest <guest@example.invalid>')).toBe(0);
    const i=await db.query<{org:string;opp:string;role:string}>(
      "select organization_id::text org,opportunity_id::text opp,metadata->>'recipient_role' role from relationship_interactions");
    expect(i.rows).toEqual([{org:ORG_B,opp:OPP_B,role:'cc'}]);
    const c=await db.query<{n:number}>('select count(*)::int n from relationship_communications');
    expect(c.rows[0].n).toBe(1);
    const o=await db.query<{status:string}>('select status from relationship_opportunities where id=$1',[OPP_B]);
    expect(o.rows[0].status).toBe('interested');
  });
  it('refuses ambiguous organization membership or unknown CC',async()=>{
    await db.query('insert into relationship_contact_organizations values ($1,$2,$3)',[TENANT,CONTACT_B,ORG_A]);
    expect(await run('guest@example.invalid')).toBe(0);
    expect(await run('stranger@example.invalid')).toBe(0);
    const r=await db.query<{n:number}>('select count(*)::int n from relationship_interactions');
    expect(r.rows[0].n).toBe(0);
  });
  it('preserves a completed opportunity stage; interaction has no active opportunity',async()=>{
    await db.query("update relationship_opportunities set status='completed' where id=$1",[OPP_B]);
    expect(await run('guest@example.invalid')).toBe(1);
    const r=await db.query<{opp:string|null}>('select opportunity_id::text opp from relationship_interactions');
    expect(r.rows[0].opp).toBeNull();
    const o=await db.query<{s:string}>('select status s from relationship_opportunities where id=$1',[OPP_B]);
    expect(o.rows[0].s).toBe('completed');
  });
});

describe('Central one-working-day reply SLA',()=>{
  let db:PGlite;
  beforeAll(async()=>{
    db=new PGlite();
    await db.exec(`
      create schema private; create role anon; create role authenticated; create role service_role;
      create table tenants(id uuid primary key);
      create table relationship_replies(
        id uuid primary key default gen_random_uuid(),
        tenant_id uuid,status text,created_at timestamptz,follow_up_due_at timestamptz,
        metadata jsonb);
    `);
    await db.query('insert into tenants values ($1)',[TENANT]);
    await db.exec(readFileSync('supabase/migrations/20261022021100_relationship_reply_workday_sla.sql','utf8'));
  },60_000);
  afterAll(async()=>db?.close());
  async function due(created:string,status='new',provided:string|null=null) {
    const result=await db.query<{due:string|null}>(
      'insert into relationship_replies(tenant_id,status,created_at,follow_up_due_at) values ($1,$2,$3,$4) returning follow_up_due_at as due',
      [TENANT,status,created,provided]);
    return result.rows[0].due ? new Date(result.rows[0].due!).toISOString() : null;
  }
  it('calculates eight working hours crossing a normal weekday',async()=>{
    expect(await due('2026-10-22T21:00:00Z')).toBe('2026-10-23T21:00:00.000Z');
  });
  it('skips the weekend, preserving one business-day effective duration',async()=>{
    expect(await due('2026-10-23T21:00:00Z')).toBe('2026-10-26T21:00:00.000Z');
  });
  it('does not replace approved due dates or assign a due date to resolved replies',async()=>{
    expect(await due('2026-10-22T21:00:00Z','new','2026-10-24T12:00:00Z')).toBe('2026-10-24T12:00:00.000Z');
    expect(await due('2026-10-22T21:00:00Z','resolved')).toBeNull();
  });
});
