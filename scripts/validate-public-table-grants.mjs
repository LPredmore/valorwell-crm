#!/usr/bin/env node
// Lightweight review guard, NOT a complete PostgreSQL parser or a live RLS test.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const IDENT = '(?:"[^"]+"|[a-z_][a-z0-9_$]*)';
const CREATE = new RegExp(`\\bcreate\\s+(?:unlogged\\s+)?table\\s+(?:if\\s+not\\s+exists\\s+)?(${IDENT})(?:\\s*\\.\\s*(${IDENT}))?`, 'gi');
const plain = s => s.replace(/^"|"$/g, '').toLowerCase();
const noLineComments = s => s.replace(/--[^\n]*/g, '');
const noComments = s => noLineComments(s).replace(/\/\*[\s\S]*?\*\//g, ' ');
const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

export function inspect(sql, filename = '<inline>') {
  const code = noComments(sql);
  const failures = [];
  for (const m of code.matchAll(CREATE)) {
    const schema = m[2] ? plain(m[1]) : null;
    const table = plain(m[2] || m[1]);
    if (!schema) {
      failures.push(`${filename}: CREATE TABLE ${table} must explicitly qualify a schema`);
      continue;
    }
    if (schema !== 'public') continue;
    const ref = `(?:public|"public")\\s*\\.\\s*(?:${escapeRegex(table)}|"${escapeRegex(table)}")`;
    const rls = new RegExp(`\\balter\\s+table\\s+(?:if\\s+exists\\s+)?${ref}\\s+enable\\s+row\\s+level\\s+security\\b`, 'i');
    if (!rls.test(code)) failures.push(`${filename}: public.${table} must ENABLE ROW LEVEL SECURITY`);
    const gr = new RegExp(`\\bgrant\\s+[^;]*?\\bon\\s+(?:table\\s+)?${ref}\\s+to\\s+[^;]*?\\bservice_role\\b[^;]*;`, 'i');
    const noApi = new RegExp(`^\\s*--\\s*@no-data-api\\s+public\\.${escapeRegex(table)}\\s*$`, 'im');
    const rev = new RegExp(`\\brevoke\\s+all\\s+on\\s+(?:table\\s+)?${ref}\\s+from\\s+([^;]+);`, 'gi');
    const revokedRoles = [...code.matchAll(rev)].flatMap(m => m[1].toLowerCase().split(',').map(x=>x.trim()));
    if (!['public','anon','authenticated'].every(x=>revokedRoles.includes(x))) {
      failures.push(`${filename}: public.${table} needs explicit REVOKE ALL from PUBLIC, anon, authenticated to override legacy defaults`);
    }
    if (noApi.test(sql) && !revokedRoles.includes('service_role')) {
      failures.push(`${filename}: public.${table} @no-data-api also needs REVOKE ALL from service_role`);
    }
    if (!gr.test(code) && !noApi.test(sql)) {
      failures.push(`${filename}: public.${table} needs an explicit service_role GRANT or -- @no-data-api public.${table}`);
    }
  }
  return failures;
}

function selfTest() {
  const ok = `create table if not exists public.sample (id uuid);\nalter table public.sample enable row level security;\nrevoke all on table public.sample from public, anon, authenticated;\ngrant select on table public.sample to service_role;`;
  assert.deepEqual(inspect(ok), []);
  assert.deepEqual(inspect(`-- @no-data-api public.sample\ncreate table public.sample (id uuid); alter table public.sample enable row level security; revoke all on table public.sample from public, anon, authenticated, service_role;`), []);
  assert.equal(inspect(`create table public.sample (id uuid);` ).length, 3);
  assert.equal(inspect(`create table private.sample (id uuid);`).length, 0);
  assert.equal(inspect(`create table sample (id uuid);`).length, 1);
  assert.deepEqual(inspect(`-- create table public.fake (id uuid);\n${ok}`), []);
  assert.deepEqual(inspect(`create table "public"."sample" (id uuid); alter table "public"."sample" enable row level security; revoke all on table "public"."sample" from public, anon, authenticated; grant select on table "public"."sample" to service_role;`), []);
  assert.equal(inspect(`${ok} grant select on table public.other to service_role;`).length, 0);
  assert.equal(inspect(`create table public.sample (id uuid); alter table public.sample enable row level security; revoke all on table public.sample from public,anon,authenticated; grant select on table public.other to service_role;`).length, 1);
  console.log('PASS: public-schema migration static guard fixtures (9)');
}

const args = process.argv.slice(2);
if (args.includes('--self-test')) selfTest();
let errors = [];
for (const filename of args.filter(x=>x!== '--self-test')) {
  if (!/^supabase\/migrations\/[A-Za-z0-9_\-.]+\.sql$/.test(filename)) {
    console.error(`Unexpected migration path: ${filename}`); process.exitCode = 1; continue;
  }
  try { errors.push(...inspect(fs.readFileSync(filename, 'utf8'), filename)); }
  catch (e) { errors.push(`${filename}: ${e.message}`); }
}
for (const e of errors) console.error(`ERROR: ${e}`);
if (errors.length) process.exitCode = 1;
else if (args.some(x=>x.endsWith('.sql'))) console.log(`PASS: checked ${args.filter(x=>x.endsWith('.sql')).length} migration file(s)`);
