// Route only known fixture adapters; preserve actual tests, workers and assertions.
import {pathToFileURL,fileURLToPath} from 'node:url';
import path from 'node:path';
import {readFileSync,realpathSync} from 'node:fs';
const here=path.dirname(fileURLToPath(import.meta.url));
const native=pathToFileURL(path.join(here,'sdk-adapter.mjs')).href;
export async function resolve(specifier,context,nextResolve){
  if(context.parentURL?.includes('/scripts/worker-integration/') &&
     ['./postgrest-client.mjs','./postgres-client.mjs','./owned-database.mjs'].includes(specifier)) return {url:native,shortCircuit:true};
  if(specifier==='resend'){
    const base=process.env.VALORWELL_NATIVE_RESEND_MODULE;
    if(!base || !path.isAbsolute(base) || realpathSync(base)!==base) throw Error('Explicit pinned Resend module required');
    const metadata=JSON.parse(readFileSync(path.resolve(path.dirname(base),'../package.json'),'utf8'));
    if(metadata.name!=='resend' || metadata.version!=='6.18.0') throw Error('Pinned Resend version required');
    return {url:pathToFileURL(base).href,shortCircuit:true};
  }
  try{return await nextResolve(specifier,context);}catch(error){
    if(!['typescript','@supabase/supabase-js'].includes(specifier)) throw error;
    return nextResolve(specifier,{...context,parentURL:pathToFileURL(path.resolve(here,'../../../package.json')).href});
  }
}
