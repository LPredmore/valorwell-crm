// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
let db: PGlite;
const tenant = '00000000-0000-0000-0000-000000000001';
const other = '00000000-0000-0000-0000-000000000002';
const a = '10000000-0000-4000-8000-000000000001';
const b = '10000000-0000-4000-8000-000000000002';
beforeAll(async () => {
  db = new PGlite();
  // Actual resolver with minimal synthetic storage. Classification is an explicit
  // stub: these cases test correlation, not the separate human/bot classifier.
  await db.exec(`create schema private;
    create function private.relationship_header_value(h jsonb,k text) returns text language sql as $$select h->>k$$;
    create function private.classify_relationship_email(h jsonb,s text,f text) returns text language sql as $$select 'human'::text$$;
    create table relationship_communications(id uuid,tenant_id uuid,direction text,enrollment_id uuid,sent_at timestamptz,occurred_at timestamptz);
    create table relationship_message_observations(communication_id uuid,tenant_id uuid,source text,provider_message_id text,provider_thread_id text,rfc_message_id text,observed_at timestamptz);
    create table relationship_contacts(tenant_id uuid,email text);`);
  await db.exec(readFileSync('supabase/migrations/20261018014500_gmail_thread_reply_anchor_direction.sql','utf8'));
},60_000);
afterAll(async () => db?.close());
beforeEach(async () => {
  await db.exec('truncate relationship_communications,relationship_message_observations,relationship_contacts');
  for (const [id,rfc] of [[a,'<a@example.invalid>'],[b,'<b@example.invalid>']]) {
    await db.query("insert into relationship_communications values ($1,$2,'outbound',null,now(),now())",[id,tenant]);
    await db.query("insert into relationship_message_observations values ($1,$2,'gmail',$3,'thread',$4,now())",[id,tenant,id,rfc]);
  }
});
async function match(headers = {}, message='new', thread='thread', tenantId=tenant) {
  const { rows } = await db.query<{ result: Record<string, unknown> }>("select private.resolve_relationship_gmail_message($1,$2,$3,$4,'sender@example.invalid',array['info@valorwell.org'],'Synthetic') as result",[tenantId,message,thread,headers]);
  return rows[0].result;
}
describe('actual Gmail correlation SQL', () => {
  it('keeps multiple prior outbound same-thread matches ambiguous', async () => {
    expect(await match()).toMatchObject({ matched:false, ambiguous:true });
  });
  it.each(['in-reply-to','references'])('resolves one exact %s anchor despite multiple thread messages', async (key) => {
    expect(await match({ [key]:'<b@example.invalid>' })).toMatchObject({ matched:true,communicationId:b,physicalExisting:false });
  });
  it('deduplicates by provider message identity', async () => {
    expect(await match({},a)).toMatchObject({ matched:true,physicalExisting:true,communicationId:a });
  });
  it('deduplicates RFC Message-ID across provider observations', async () => {
    expect(await match({ 'message-id':'<a@example.invalid>' })).toMatchObject({ matched:true,physicalExisting:true,communicationId:a });
  });
  it('preserves ambiguous references across unrelated conversations', async () => {
    expect(await match({ references:'<a@example.invalid> <b@example.invalid>' })).toMatchObject({ matched:false,ambiguous:true });
  });
  it('does not use inbound-only thread history as an outbound anchor', async () => {
    await db.exec("update relationship_communications set direction='inbound'");
    expect(await match({ 'in-reply-to':'<a@example.invalid>' })).toMatchObject({ matched:false });
  });
  it('never correlates foreign-tenant observations', async () => {
    expect(await match({ 'message-id':'<a@example.invalid>','in-reply-to':'<b@example.invalid>' },a,'thread',other)).toMatchObject({ matched:false });
  });
  it('marks an unanchored known contact for review without inferring an organization', async () => {
    await db.query('insert into relationship_contacts values ($1,$2)',[tenant,'sender@example.invalid']);
    expect(await match({},'new','new-thread')).toMatchObject({ matched:false,ambiguous:true,likelyRelationship:true });
  });
});
