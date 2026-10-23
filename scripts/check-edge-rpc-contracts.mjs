#!/usr/bin/env node
// Fails when Edge Function code calls a PostgREST RPC that no tracked
// migration defines. Prevents deploying code that depends on SQL that was
// never written (the 2026-10-23 Gmail PGRST202 incident). It cannot prove the
// production ledger applied the migration; the predeploy live check does that.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
};

export function rpcCalls(source) {
  return [...source.matchAll(/\.rpc\(\s*["'`]([a-z0-9_]+)["'`]/gi)].map(m => m[1]);
}

export function definedFunctions(sql) {
  return new Set([...sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:"?public"?\.)?"?([a-z0-9_]+)"?\s*\(/gi)]
    .map(m => m[1].toLowerCase()));
}

export function missingRpcs(calls, defined, allow) {
  return [...new Set(calls)].filter(n => !defined.has(n.toLowerCase()) && !allow.has(n)).sort();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sqlFiles = walk(join(root, 'supabase/migrations')).filter(f => f.endsWith('.sql'));
  const defined = new Set();
  for (const f of sqlFiles) for (const n of definedFunctions(readFileSync(f, 'utf8'))) defined.add(n);
  const allowPath = join(root, 'scripts/edge-rpc-baseline-allowlist.txt');
  const allow = new Set(readFileSync(allowPath, 'utf8').split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#')));
  const calls = walk(join(root, 'supabase/functions')).filter(f => f.endsWith('.ts'))
    .flatMap(f => rpcCalls(readFileSync(f, 'utf8')));
  const missing = missingRpcs(calls, defined, allow);
  if (missing.length) {
    console.error(`Edge Functions call RPCs with no tracked migration definition:\n  ${missing.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`Edge RPC contract check passed (${new Set(calls).size} RPCs).`);
}
