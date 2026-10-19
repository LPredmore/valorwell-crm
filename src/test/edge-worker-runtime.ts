import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

/** Execute unmodified Edge source in an isolate. Network is denied unless supplied
 * by the test; Deno environment and Supabase client are exclusively synthetic. */
export function edgeRuntime(entry: string, options: {
  db: unknown;
  env?: Record<string, string>;
  fetch?: typeof fetch;
  imports?: Record<string, unknown>;
}) {
  let handler: (request: Request) => Promise<Response>;
  const modules = new Map<string, { exports: Record<string, unknown> }>();
  const environment = {
    SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service',
    CRON_SECRET: 'synthetic-cron', RESEND_API_KEY: 'synthetic-provider', ...options.env,
  };
  function load(path: string): Record<string, unknown> {
    if (modules.has(path)) return modules.get(path)!.exports;
    const module = { exports: {} };
    modules.set(path, module);
    const code = ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    runInNewContext(code, {
      module, exports: module.exports,
      require: (specifier: string) => {
        if (options.imports?.[specifier]) return options.imports[specifier];
        if (specifier.includes('@supabase/supabase-js')) return { createClient: () => options.db };
        if (specifier.startsWith('jsr:')) return {};
        if (!specifier.startsWith('.')) throw new Error(`Unmocked import: ${specifier}`);
        return load(resolve(dirname(path), specifier));
      },
      Deno: { env: { get: (key: string) => environment[key] }, serve: (callback: typeof handler) => { handler = callback; } },
      fetch: options.fetch ?? (() => { throw new Error('Network disabled in worker tests'); }),
      Request, Response, Headers, URL, URLSearchParams, crypto, TextEncoder, TextDecoder, Error,
      Date, setTimeout, clearTimeout, console: { log() {}, error() {}, warn() {} },
    }, { filename: path });
    return module.exports;
  }
  load(resolve(entry));
  return (body: unknown = {}, headers: Record<string, string> = {}, method = 'POST') => handler(new Request('http://127.0.0.1/worker', {
    method, headers: { 'content-type': 'application/json', ...headers },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
  }));
}
