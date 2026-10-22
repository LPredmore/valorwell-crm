// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
const T='00000000-0000-0000-0000-000000000001';
const O='00000000-0000-0000-0000-000000000002';
const C='00000000-0000-0000-0000-000000000003';
const M='00000000-0000-0000-0000-000000000004';
const I='00000000-0000-0000-0000-000000000005';
const P='00000000-0000-0000-0000-000000000006';
const A='00000000-0000-0000-0000-000000000007';
const K='00000000-0000-0000-0000-000000000008';
const sql=(f:string)=>readFileSync('supabase/migrations/'+f,'utf8');
// Real new functions run against a minimal offline schema. Auth context is an
// explicit test double; this is not a signed-JWT or production release test.
describe('source-safe reconciliation and authorized review completion',()=>{
 let db:PGlite;
 async function one<T>(q:string,args:unknown[]=[]){return (await db.query<{result:T}>(q,args)).rows[0].result;}
 const preview=()=>one<{eligible:number;blocked:number;tasks:unknown[]}>('select process_relationship_email_review_task_cleanup(false,100) result');
 const repair=(apply=false)=>one<Record<string,number>>('select private.reconcile_anchored_relationship_email_links($1,100) result',[apply]);
 const receipt=(id='original',rfc='<original@example.invalid>')=>db.query('select record_relationship_gmail_source_receipt($1,$2,$3,$4,$5::jsonb,$6::jsonb)',[T,id,'thread','info@valorwell.org',JSON.stringify({from:'info@valorwell.org',to:'contact@example.invalid','message-id':rfc}),JSON.stringify(['SENT'])]);
 beforeAll(async()=>{
  db=new PGlite();
  await db.exec(`create schema private; create schema auth;
   create function auth.uid() returns uuid language sql as $$select case when current_setting('test.authorized',true)='yes' then '${A}'::uuid end$$;
   create table relationship_organizations(id uuid,tenant_id uuid); insert into relationship_organizations values('${O}','${T}');
   create table tenant_memberships(profile_id uuid,tenant_id uuid); insert into tenant_memberships values('${A}','${T}');
   create role anon; create role authenticated; create role service_role;
   create table tenants(id uuid primary key); insert into tenants values('${T}');
   create table relationship_contacts(id uuid primary key,tenant_id uuid,email text);
   create table relationship_opportunities(id uuid primary key,tenant_id uuid,organization_id uuid,primary_contact_id uuid,status text);
   create table relationship_communications(id uuid primary key,tenant_id uuid,contact_id uuid,organization_id uuid,opportunity_id uuid,provider text,provider_message_id text,provider_thread_id text,direction text,sender_email text,recipient_email text,subject text,metadata jsonb default '{}');
   create table relationship_replies(id uuid,tenant_id uuid,communication_id uuid,opportunity_id uuid,contact_id uuid,organization_id uuid);
   create table relationship_message_observations(id uuid,tenant_id uuid,communication_id uuid,source text,provider_message_id text,rfc_message_id text);
   create table relationship_reconciliation_issues(id uuid primary key default gen_random_uuid(),tenant_id uuid,status text default 'open',source text,external_event_id text,issue_type text,summary text,details jsonb default '{}',resolution text,opportunity_id uuid,activity_event_id uuid,resolved_at timestamptz,created_at timestamptz default now(),updated_at timestamptz);
   create unique index issue_open on relationship_reconciliation_issues(tenant_id,issue_type,source,external_event_id) where status='open' and external_event_id is not null;
   create table private.relationship_email_issue_triage(issue_id uuid,tenant_id uuid,source text,classification text,observed_communication_id uuid,review_state text,group_key text,candidate_organization_id uuid,candidate_opportunity_id uuid,review_task_id uuid,updated_at timestamptz);
   create type crm_task_status_enum as enum('not_started','completed');
   create table crm_tasks(id uuid primary key,tenant_id uuid,title text,status crm_task_status_enum,relationship_organization_id uuid,owner_id uuid,relationship_contact_id uuid,relationship_opportunity_id uuid,client_id uuid,staff_id uuid,campaign_id uuid,exception_id uuid,created_by_profile_id uuid,description text,completed_at timestamptz,updated_at timestamptz);
   create table private.relationship_email_review_groups(tenant_id uuid,group_key text,task_id uuid,organization_id uuid,owner_profile_id uuid,issue_count int,updated_at timestamptz);
   create table crm_email_messages(id uuid,tenant_id uuid,provider text,provider_message_id text);
   create table relationship_activity_events(id uuid,tenant_id uuid,source text,external_event_id text);
   create table private.relationship_google_connections(id uuid,tenant_id uuid,connection_type text,status text);
   create table private.relationship_google_sync_state(connection_id uuid,last_successful_sync_at timestamptz,last_notification_at timestamptz,last_error_code text,last_error_reason text,gmail_watch_expiration timestamptz);
   create function private.relationship_orchestration_context(boolean) returns jsonb language plpgsql as $$begin
    if current_setting('test.authorized',true) is distinct from 'yes' then raise exception 'Unauthorized'; end if;
    return jsonb_build_object('tenant_id',coalesce(nullif(current_setting('test.tenant',true),''),'${T}'),'actor_id','${A}'); end;$$;
   create function private.crm_has_relationship_permission(uuid,uuid,text) returns boolean language sql as $$select current_setting('test.authorized',true)='yes'$$;
  `);
  const guard=sql('20261018165034_relationship_centric_attention.sql');
  await db.exec(guard.slice(guard.indexOf('CREATE OR REPLACE FUNCTION private.crm_validate_relationship_task_subject()'),guard.indexOf('-- No new ledger:')));
  await db.exec('create trigger task_guard before insert or update on crm_tasks for each row execute function private.crm_validate_relationship_task_subject()');
  const old=sql('20261018005000_relationship_email_anchored_structural_repair.sql');
  await db.exec(old.slice(0,old.indexOf('create or replace function')));
  await db.exec(sql('20261022195806_relationship_source_identity_gate.sql'));
  await db.exec(sql('20261022195848_relationship_review_organization_completion.sql'));
  await db.exec(sql('20261022195938_relationship_source_recovery_report.sql'));
 },60_000);
 afterAll(async()=>db?.close());
 beforeEach(async()=>{
  await db.exec(`truncate relationship_reconciliation_issues,relationship_communications,relationship_opportunities,relationship_contacts,relationship_replies,relationship_message_observations,private.relationship_email_issue_triage,private.relationship_email_review_groups,crm_tasks,private.relationship_gmail_source_receipts,private.relationship_email_structural_link_audit cascade;
   set test.authorized='yes'; set test.tenant='${T}';
   insert into relationship_contacts values('${C}','${T}','contact@example.invalid');
   insert into relationship_opportunities values('${P}','${T}','${O}','${C}','interested');
   insert into relationship_communications(id,tenant_id,contact_id,organization_id,provider,provider_message_id,provider_thread_id,direction,sender_email,recipient_email,subject) values('${M}','${T}','${C}','${O}','gmail','original','thread','outbound','info@valorwell.org','contact@example.invalid','Beyond the Yellow');
   insert into relationship_reconciliation_issues(id,tenant_id,source,external_event_id,issue_type) values('${I}','${T}','gmail','original','ambiguous_email_thread');
   insert into private.relationship_email_issue_triage values('${I}','${T}','gmail','existing_communication_needs_opportunity_review','${M}','needs_review','org','${O}',null,'${K}',now());
   insert into crm_tasks(id,tenant_id,title,status,relationship_organization_id,owner_id,created_by_profile_id) values('${K}','${T}','Review BTY email associations · Synthetic','not_started','${O}','${A}','${A}');
   insert into private.relationship_email_review_groups values('${T}','org','${K}','${O}','${A}',1,now());`);
 });
 it('uses the literal review-task title prefix consistently across preview and apply',()=>{
  const migration=sql('20261022195848_relationship_review_organization_completion.sql');
  expect(migration).not.toContain('Review BTY email associations Â·');
  expect(migration.match(/Review BTY email associations · %/g)).toHaveLength(3);
 });
 it('blocks all seven structural candidates without source identity, including later same-thread mail',async()=>{
  for(let n=1;n<7;n++) await db.exec(`insert into relationship_reconciliation_issues(id,tenant_id,source,external_event_id) values(gen_random_uuid(),'${T}','gmail','original-${n}'); insert into private.relationship_email_issue_triage select id,'${T}','gmail','existing_communication_needs_opportunity_review','${M}','needs_review','org','${O}',null,'${K}',now() from relationship_reconciliation_issues where external_event_id='original-${n}';`);
  await receipt('later');
  expect((await repair()).eligible).toBe(0); expect((await repair(true)).communicationsLinked).toBe(0);
  expect(await one<number>("select count(*)::int result from relationship_reconciliation_issues where status='open'")).toBe(7);
 });
 it('applies exact source once with audit; leaves stages and later physical messages unchanged',async()=>{
  await receipt(); await receipt();
  await db.exec(`insert into relationship_communications select gen_random_uuid(),tenant_id,contact_id,organization_id,null,provider,'later',provider_thread_id,direction,sender_email,recipient_email,subject,metadata from relationship_communications where id='${M}'`);
  expect((await repair()).eligible).toBe(1); expect((await repair(true)).communicationsLinked).toBe(1); expect((await repair(true)).communicationsLinked).toBe(0);
  expect(await one<string>(`select status result from relationship_opportunities where id='${P}'`)).toBe('interested');
  expect(await one<number>('select count(*)::int result from private.relationship_email_structural_link_audit')).toBe(1);
  expect(await one<null>("select opportunity_id result from relationship_communications where provider_message_id='later'")).toBeNull();
 });
 it('rejects conflicting RFC identity and foreign-tenant receipts',async()=>{
  await receipt();
  await db.exec(`insert into relationship_message_observations values(gen_random_uuid(),'${T}','${M}','gmail','original','<conflict@example.invalid>')`);
  expect((await repair()).eligible).toBe(0);
  await db.exec('truncate relationship_message_observations');
  await db.exec(`insert into tenants values('${O}') on conflict do nothing; update private.relationship_gmail_source_receipts set tenant_id='${O}'`);
  expect((await repair()).eligible).toBe(0);
 });
 it('does not trust a stored sent status, drafts, wrong recipients, or a different claimed ID',async()=>{
  await receipt(); await db.exec(`update private.relationship_gmail_source_receipts set label_ids='["DRAFT"]'`); expect((await repair()).eligible).toBe(0);
  await db.exec(`update private.relationship_gmail_source_receipts set label_ids='["SENT"]',headers=jsonb_set(headers,'{to}','"other@example.invalid"')`); expect((await repair()).eligible).toBe(0);
  await receipt(); await db.exec("update relationship_reconciliation_issues set external_event_id='other'"); expect((await repair()).eligible).toBe(0);
 });
 it('previews resolved and source-verified ignored outcomes; recomputes at apply',async()=>{
  await db.exec("update relationship_reconciliation_issues set status='resolved'; update private.relationship_email_issue_triage set review_state='approved'");
  expect((await preview()).eligible).toBe(1);
  await db.exec(`insert into relationship_reconciliation_issues(tenant_id,status,source,external_event_id,details) values('${T}','open','gmail','new','{"thread_organization_review_20261022":{"organization_id":"${O}"}}')`);
  expect((await preview()).blocked).toBe(1);
  expect(await one('select process_relationship_email_review_task_cleanup(true,100) result')).toMatchObject({completed:0});
 });
 it('completes documented ignored dispositions idempotently without rewriting history',async()=>{
  await db.exec(`update relationship_reconciliation_issues set status='ignored',resolution='Verified automatic response',details='{"source_verification":{"provider":"gmail","provider_message_id":"original","verified_at_utc":"2026-10-22T00:00:00Z","reason_kind":"automatic_reply"}}'`);
  expect((await preview()).eligible).toBe(1);
  expect(await one('select process_relationship_email_review_task_cleanup(true,100) result')).toMatchObject({completed:1});
  expect(await one('select process_relationship_email_review_task_cleanup(true,100) result')).toMatchObject({completed:0});
  expect(await one('select review_task_id result from private.relationship_email_issue_triage')).toBe(K);
  expect(await one('select task_id result from private.relationship_email_review_groups')).toBeNull();
  await db.exec(`insert into relationship_reconciliation_issues(tenant_id,status,source,external_event_id) values('${T}','open','gmail','new'); insert into private.relationship_email_issue_triage(issue_id,tenant_id,source,review_state,group_key) select id,'${T}','gmail','needs_review','org' from relationship_reconciliation_issues where external_event_id='new'; insert into crm_tasks(id,tenant_id,title,status,relationship_organization_id,owner_id,created_by_profile_id) values('${P}','${T}','Review BTY email associations · Synthetic','not_started','${O}','${A}','${A}')`);
  await db.query('select link_relationship_email_review_task($1,$2)',['org',P]);
  expect(await one('select review_task_id result from private.relationship_email_issue_triage where issue_id=$1',[I])).toBe(K);
  expect(await one('select task_id result from private.relationship_email_review_groups')).toBe(P);
 });
 it('denies unauthorized completion and isolates the authenticated tenant',async()=>{
  await db.exec("set test.authorized='no'"); await expect(preview()).rejects.toThrow('Unauthorized');
  await expect(db.exec("update crm_tasks set status='completed'")).rejects.toThrow('Relationship task mutation is not authorized');
  await expect(one('select process_relationship_email_review_task_cleanup(true,100) result')).rejects.toThrow('Unauthorized');
  await db.exec(`set test.authorized='yes'; set test.tenant='${O}'`); expect((await preview()).eligible).toBe(0);
  expect(await one('select get_relationship_email_source_recovery() result')).toEqual([]);
  expect(await one<boolean>("select has_function_privilege('authenticated','public.record_relationship_gmail_source_receipt(uuid,text,text,text,jsonb,jsonb)','execute') result")).toBe(false);
 });
 it('rejects ignored outcomes without exact documented source review',async()=>{
  await db.exec("update relationship_reconciliation_issues set status='ignored',resolution='Thread seems right'; update private.relationship_email_issue_triage set review_state='rejected'"); expect((await preview()).eligible).toBe(0);
 });
 it('retains retrieval failures idempotently and reports exact stored evidence without mutation',async()=>{
  await db.query('select record_relationship_gmail_retrieval_failure($1,$2)',['missing','FORBIDDEN']);
  await db.query('select record_relationship_gmail_retrieval_failure($1,$2)',['missing','FORBIDDEN']);
  const report=await one<Array<Record<string,unknown>>>('select get_relationship_email_source_recovery() result');
  expect(report).toHaveLength(2); expect(report.every(r=>r.exactIdentityVerified===false)).toBe(true);
  expect((await repair()).eligible).toBe(0);
 });
 it('reports unknown sync age as null and shows persisted push and failures',async()=>{
  await db.exec(`insert into private.relationship_google_connections values('${K}','${T}','gmail','connected'); insert into private.relationship_google_sync_state(connection_id,last_notification_at,last_error_code,last_error_reason) values('${K}',now(),'FORBIDDEN','Provider access denied')`);
  const diagnostics=await one<Array<Record<string,unknown>>>('select get_relationship_gmail_diagnostics() result');
  expect(diagnostics[0]).toMatchObject({secondsSinceSuccessfulSync:null,lastErrorCode:'FORBIDDEN'});
  expect(diagnostics[0].lastPushAt).toBeTruthy();
 });

});
