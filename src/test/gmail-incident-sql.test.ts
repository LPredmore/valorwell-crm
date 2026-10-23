// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const tenant = '00000000-0000-0000-0000-000000000001';
const staged = readFileSync('supabase/staged-migrations/20261023150000_crm_gmail_receipt_incident_repair.sql', 'utf8');
// Real staged SQL, minimal dependencies only; role simulation is NOT signed JWT acceptance.
describe('minimal staged Gmail incident SQL', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`CREATE SCHEMA private; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE public.tenants(id uuid PRIMARY KEY);
      INSERT INTO public.tenants VALUES('${tenant}');
      CREATE TABLE public.relationship_reconciliation_issues(
        tenant_id uuid NOT NULL,issue_type text,source text,external_event_id text,
        summary text,details jsonb,status text DEFAULT 'open',updated_at timestamptz);
      CREATE UNIQUE INDEX issue_open ON public.relationship_reconciliation_issues(tenant_id,issue_type,source,external_event_id)
        WHERE status='open' AND external_event_id IS NOT NULL;`);
    for (const [name, args] of [
      ['get_relationship_google_sync_state', 'uuid'],
      ['update_relationship_google_sync_state', 'uuid,text,timestamptz,text,boolean,boolean,boolean,text,text'],
      ['match_relationship_gmail_message', 'uuid,text,text,jsonb,text,text[],text'],
      ['ingest_relationship_gmail_message', 'uuid,text,text,jsonb,text,text[],text,text,timestamptz,text[]'],
      ['claim_relationship_gmail_backfill', 'uuid,uuid,integer'],
      ['checkpoint_relationship_gmail_backfill', 'uuid,uuid,text,text,boolean,integer,integer,integer,integer'],
      ['release_relationship_gmail_backfill', 'uuid,uuid,text,text'],
    ]) {
      await db.exec(`CREATE FUNCTION public.${name}(${args}) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$SELECT '{}'::jsonb$$;
        REVOKE ALL ON FUNCTION public.${name}(${args}) FROM PUBLIC,anon,authenticated;
        GRANT EXECUTE ON FUNCTION public.${name}(${args}) TO service_role;`);
    }
    await db.exec(staged);
  }, 60_000);
  afterAll(async () => db?.close());
  const record = (id: string, t: string | null = tenant, thread = 'thread', labels = ['SENT'], rfc = '<synthetic@example.invalid>') =>
    db.query('SELECT public.record_relationship_gmail_source_receipt($1,$2,$3,$4,$5::jsonb,$6::jsonb)',
      [t, id, thread, 'info@valorwell.org', JSON.stringify({ 'message-id': rfc }), JSON.stringify(labels)]);
  it('accepts repeat retrieval without duplicate receipt', async () => {
    await record('repeat'); await record('repeat');
    expect((await db.query<{ count: number }>("SELECT count(*)::int count FROM private.relationship_gmail_source_receipts WHERE provider_message_id='repeat'")).rows[0]?.count).toBe(1);
  });
  it('rejects foreign and null tenants', async () => {
    await expect(record('foreign', '00000000-0000-0000-0000-000000000002')).rejects.toThrow('Invalid authoritative');
    await expect(record('null', null)).rejects.toThrow('Invalid authoritative');
  });
  it('rejects drafts and thread or RFC identity replacement', async () => {
    await expect(record('draft', tenant, 'thread', ['DRAFT'])).rejects.toThrow('Invalid authoritative');
    await record('immutable');
    await expect(record('immutable', tenant, 'other')).rejects.toThrow('Conflicting Gmail identity');
    await expect(record('immutable', tenant, 'thread', ['SENT'], '<different@example.invalid>')).rejects.toThrow('Conflicting Gmail identity');
  });
  it('denies browser roles table access and writer execution, including authenticated admins', async () => {
    for (const role of ['anon', 'authenticated']) {
      const result = await db.query<{ table_access: boolean; writer_access: boolean }>(`SELECT
        has_table_privilege('${role}','private.relationship_gmail_source_receipts','SELECT,INSERT,UPDATE,DELETE') table_access,
        has_function_privilege('${role}','public.record_relationship_gmail_source_receipt(uuid,text,text,text,jsonb,jsonb)','EXECUTE') writer_access`);
      expect(result.rows[0]).toEqual({ table_access: false, writer_access: false });
      await db.exec(`SET ROLE ${role}`);
      try { await expect(record('denied')).rejects.toThrow('permission denied'); }
      finally { await db.exec('RESET ROLE'); }
    }
  });
  it('retains failures idempotently and refuses null status', async () => {
    await db.exec("SELECT record_relationship_gmail_retrieval_failure('unreadable','FORBIDDEN'); SELECT record_relationship_gmail_retrieval_failure('unreadable','FORBIDDEN')");
    expect((await db.query<{ count: number }>('SELECT count(*)::int count FROM relationship_reconciliation_issues')).rows[0]?.count).toBe(1);
    await expect(db.exec("SELECT record_relationship_gmail_retrieval_failure('invalid',NULL)")).rejects.toThrow('Invalid source retrieval');
  });
  it('handshake detects unsafe execute grants and recovers when removed', async () => {
    const read = async () => (await db.query<{ contract: { ready: boolean; failures: string[] } }>('SELECT get_relationship_gmail_runtime_contract() contract')).rows[0]?.contract;
    expect(await read()).toMatchObject({ ready: true, failures: [] });
    await db.exec('GRANT EXECUTE ON FUNCTION record_relationship_gmail_retrieval_failure(text,text) TO authenticated');
    expect(await read()).toMatchObject({ ready: false });
    await db.exec('REVOKE EXECUTE ON FUNCTION record_relationship_gmail_retrieval_failure(text,text) FROM authenticated');
    expect(await read()).toMatchObject({ ready: true });
  });
  it('reapplication refuses to overwrite concurrently established objects', async () => {
    await expect(db.exec(staged)).rejects.toThrow('already exist');
  });
});