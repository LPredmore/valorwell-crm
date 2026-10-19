import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { Resend } from 'resend';

export function loadEdge(entry, { createClient, providerFetch, env }) {
  let handler;
  const context = vm.createContext({
    Request, Response, Headers, URL, URLSearchParams, TextEncoder, TextDecoder,
    crypto: globalThis.crypto, setTimeout, clearTimeout, Error, Date,
    console: { log() {}, warn() {}, error() {} },
    fetch: providerFetch ?? (() => { throw new Error('Unmocked provider egress denied'); }),
    Deno: { env: { get: (key) => env[key] }, serve: (fn) => { handler = fn; } },
  });
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const execute = vm.runInContext(`(function(require,module,exports){${code}\n})`, context, { filename });
    execute((specifier) => {
      if (specifier.includes('@supabase/supabase-js')) return { createClient };
      if (specifier.startsWith('npm:resend@')) return { Resend };
      if (specifier.startsWith('jsr:')) return {};
      if (!specifier.startsWith('.')) throw new Error(`Unapproved worker import ${specifier}`);
      return load(path.resolve(path.dirname(filename), specifier));
    }, module, module.exports);
    return module.exports;
  }
  load(path.resolve(entry));
  if (!handler) throw new Error('Worker did not register HTTP handler');
  return (body = {}, headers = {}, query = '') => handler(new Request('http://127.0.0.1/worker'+query, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }));
}
