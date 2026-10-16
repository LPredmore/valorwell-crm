import { build } from 'esbuild';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const crm = path.resolve(here, '../..');
const upstream = path.resolve(process.env.AGENTIC_INBOX_SOURCE || path.join(crm, '../upstream-agentic-inbox'));
const boundaries = path.join(here, 'runtime-boundaries.mjs');
await mkdir(path.join(here, 'generated'), { recursive: true });

const boundaryPlugin = {
  name: 'offline-runtime-boundaries',
  setup(b) {
    b.onResolve({ filter: /^(cloudflare:workers|@cloudflare\/ai-chat|workers-ai-provider|ai)$/ }, () => ({ path: boundaries }));
    b.onResolve({ filter: /^jsr:/ }, () => ({ path: 'empty', namespace: 'empty' }));
    b.onLoad({ filter: /.*/, namespace: 'empty' }, () => ({ contents: '', loader: 'js' }));
    b.onResolve({ filter: /^(https:\/\/esm.sh\/@supabase\/supabase-js|npm:@supabase\/supabase-js|npm:resend)/ }, () => ({ path: boundaries }));
    b.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: boundaries }));
    b.onResolve({ filter: /^@\// }, a => ({ path: path.join(crm, 'src', a.path.slice(2)) + (path.extname(a.path) ? '' : '.ts') }));
    // Expose the real existing inbound handler without editing its source file.
    b.onLoad({ filter: /crm-resend-email\/index\.ts$/ }, async a => ({ contents: (await readFile(a.path, 'utf8')) + '\nexport { handleInbound };\n', loader: 'ts', resolveDir: path.dirname(a.path) }));
  },
};
const common = { bundle: true, platform: 'node', target: 'node24', format: 'esm', sourcemap: true, plugins: [boundaryPlugin], logLevel: 'warning' };

await build({ ...common, stdin: { contents: `export * from '${upstream}/workers/lib/tools.ts'; export { MailboxDO } from '${upstream}/workers/durableObject/index.ts'; export { receiveEmail } from '${upstream}/workers/index.ts'; export { EmailAgent } from '${upstream}/workers/agent/index.ts';`, resolveDir: upstream, loader: 'ts' }, outfile: path.join(here, 'generated/upstream.mjs') });
await build({ ...common, stdin: { contents: `export { supabaseTasksRepository } from '${crm}/src/repositories/supabase/tasks.ts'; export { callGeminiModel } from '${crm}/supabase/functions/_shared/ai-ops.ts'; export { handleInbound } from '${crm}/supabase/functions/crm-resend-email/index.ts';`, resolveDir: crm, loader: 'ts' }, outfile: path.join(here, 'generated/crm.mjs') });
await writeFile(path.join(here, 'generated/build-provenance.json'), JSON.stringify({ crm, upstream, boundaryMocks: ['Cloudflare runtime', 'AI inference', 'Supabase network client', 'Resend SDK (unused send methods)'], sourceExports: ['real MailboxDO', 'real receiveEmail', 'real EmailAgent', 'real email tools', 'real CRM handleInbound', 'real CRM task repository', 'real Gemini helper'] }, null, 2));
console.log('Built actual upstream and CRM source modules with offline runtime boundaries.');
