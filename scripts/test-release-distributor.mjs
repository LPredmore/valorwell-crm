import {readFileSync,readdirSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync,spawn} from 'node:child_process';
import {strict as assert} from 'node:assert';
const container='valorwell-distributor-test';
const database='distributor_test_'+Date.now();
const args=['exec','-i',container,'psql','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-q','-At'];
const sql=s=>execFileSync('docker',args,{input:s,encoding:'utf8'});
const bootstrap=`do $$begin
if not exists(select from pg_roles where rolname='anon')then create role anon;end if;
if not exists(select from pg_roles where rolname='authenticated')then create role authenticated;end if;
if not exists(select from pg_roles where rolname='service_role')then create role service_role bypassrls;end if;end$$;
create schema auth; create function auth.uid() returns uuid language sql as 'select null::uuid';
create function public.is_tenant_admin(uuid,uuid) returns boolean language sql as 'select false';
create table tenants(id uuid primary key); insert into tenants values ('00000000-0000-0000-0000-000000000001');
create table ai_operations_video_projects(id uuid primary key,tenant_id uuid);
create table ai_operations_video_clips(id uuid primary key,project_id uuid,clip_type text,drive_file_id text,facebook_description text,linkedin_description text,tiktok_description text);
create table ai_operations_social_publications(id uuid primary key,tenant_id uuid,platform text,external_video_id text,clip_id uuid,project_id uuid,source_type text,status text,desired_privacy_status text,created_at timestamptz default now());
grant usage on schema public to service_role; grant all on all tables in schema public to service_role;`;
execFileSync('docker',['exec',container,'createdb','-U','postgres',database]);
try {
  sql(bootstrap);
  const migrations=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(n=>/_(youtube_release_distributor|distribution_media_leases|distribution_reconciliation_controls|distribution_worker_policies|distribution_live_test_gate_and_metadata)\.sql$/.test(n)).sort();
  for(const m of migrations)sql(readFileSync(new URL('../supabase/migrations/'+m,import.meta.url),'utf8'));
  sql(readFileSync(new URL('../supabase/tests/release-distributor.sql',import.meta.url),'utf8'));
  sql(`update ai_operations_distribution_config set publishing_enabled=true,baseline_completed_at=now();
update ai_operations_distribution_destinations set enabled=true,credential_verified_at=now();
select distribution_observe('00000000-0000-0000-0000-000000000001','{"id":"concurrent1","channel_id":"UCVcoBzMSzuABGxJ5Ne5EBtw","visibility":"public"}');
insert into ai_operations_distribution_overrides(tenant_id,release_id,facebook_description,linkedin_description)select tenant_id,id,'Facebook','LinkedIn' from ai_operations_youtube_release_registry;
select distribution_prepare(tenant_id,id) from ai_operations_youtube_release_registry;`);
  const worker=label=>new Promise((resolve,reject)=>{const p=spawn('docker',args);let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',reject);p.on('close',code=>code?reject(new Error(err)):resolve(out));p.stdin.end(`begin;set local role service_role;select distribution_claim('00000000-0000-0000-0000-000000000001','${label}')->>'id';select pg_sleep(1);commit;`);});
  const claimed=await Promise.all([worker('concurrent-a'),worker('concurrent-b')]);
  const ids=claimed.map(s=>s.match(/[a-f0-9]{8}-[a-f0-9-]{27}/)?.[0]);
  assert(ids[0]&&ids[1]);assert.notEqual(ids[0],ids[1]);
  assert.equal(sql('set role authenticated;select count(*) from ai_operations_social_distribution_deliveries;').trim(),'0');
  const report={at:new Date().toISOString(),database_assertions:'passed',concurrent_workers:'passed: distinct deliveries while both transactions held locks',tenant_read_isolation:'passed: non-admin sees zero rows',external_requests:0,migrations};
  mkdirSync(new URL('../docs/distributor-evidence/',import.meta.url),{recursive:true});
  writeFileSync(new URL('../docs/distributor-evidence/database-tests.json',import.meta.url),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally {execFileSync('docker',['exec',container,'dropdb','-U','postgres',database]);}
