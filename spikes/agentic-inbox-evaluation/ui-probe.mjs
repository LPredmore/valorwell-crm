import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const here=path.dirname(fileURLToPath(import.meta.url));
const crm=path.resolve(here,'../..');
const upstream=path.resolve(process.env.AGENTIC_INBOX_SOURCE || path.join(crm,'../upstream-agentic-inbox'));
const require=createRequire(path.join(crm,'package.json'));
const result={scope:'Server-render real upstream inbox route with CRM React, Router and Query versions; cached synthetic email. No browser interactions or CSS verification.'};
try {
 await build({bundle:true,format:'esm',platform:'node',target:'node24',jsx:'automatic',outfile:path.join(here,'generated/ui.mjs'),
  banner:{js:"import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);"},
  define:{'import.meta.env.DEV':'false'},
  stdin:{resolveDir:upstream,loader:'tsx',contents:`
   import React from 'react'; import {renderToString} from 'react-dom/server';
   import {MemoryRouter,Routes,Route} from 'react-router';
   import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
   import {TooltipProvider,Toasty} from '@cloudflare/kumo';
   import Inbox from './app/routes/email-list';
   const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity,gcTime:0}}});
   const box='inbox-a@example.test';
   client.setQueryData(['emails',box,{folder:'inbox',page:'1',limit:'25',threaded:'true'}],{emails:[{id:'fixture',sender:'guest@example.test',recipient:box,subject:'Fixture interview invitation',snippet:'Synthetic reply',date:'2026-10-16T12:00:00Z',folder:'inbox',read:false,thread_count:1}],totalCount:1});
   client.setQueryData(['folders',box],[{id:'inbox',name:'Inbox'}]);
   export const html=renderToString(<QueryClientProvider client={client}><TooltipProvider><Toasty><MemoryRouter initialEntries={['/'+box+'/inbox']}><Routes><Route path='/:mailboxId/:folder' element={<Inbox/>}/></Routes></MemoryRouter></Toasty></TooltipProvider></QueryClientProvider>);
   client.clear();
  `},
  plugins:[{name:'crm-runtime-and-upstream-aliases',setup(b){
   b.onResolve({filter:/^(react(?:\/.*)?|react-dom(?:\/.*)?|react-router|@tanstack\/react-query)$/},a=>({path:require.resolve(a.path==='react-router'?'react-router-dom':a.path),external:true}));
   b.onResolve({filter:/^~\//},a=>({path:path.join(upstream,'app',a.path.slice(2))+(/\.[a-z]+$/.test(a.path)?'':(/components\//.test(a.path)?'.tsx':'.ts'))}));
   b.onResolve({filter:/^shared\//},a=>({path:path.join(upstream,a.path)+'.ts'}));
  }}],logLevel:'warning'});
 const rendered=await import('./generated/ui.mjs');
 assert.match(rendered.html,/Fixture interview invitation/);
 result.status='pass';result.bytes=rendered.html.length;
 await writeFile(path.join(here,'results/ui-ssr.html'),rendered.html);
} catch(error) {result.status='blocked';result.error=String(error.stack||error);}
for(const [name,root] of [['crm',crm],['upstream',upstream]]){
 const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
 result[name]={react:pkg.dependencies.react,router:pkg.dependencies['react-router']||pkg.dependencies['react-router-dom'],tailwind:pkg.devDependencies?.tailwindcss||pkg.dependencies.tailwindcss};
}
await writeFile(path.join(here,'results/ui-probe.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
