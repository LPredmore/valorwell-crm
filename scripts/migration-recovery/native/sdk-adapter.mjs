// Adapt existing fixture imports to the label-verified native internal network.
// Existing workers/tests and their assertions remain unchanged.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFileSync,statSync,realpathSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHmac,randomBytes} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
const execute=promisify(execFile);
const directory=path.dirname(fileURLToPath(import.meta.url));
const root=process.env.VALORWELL_NATIVE_RUN;
if(!root || !path.isAbsolute(root) || root.includes('..') || realpathSync(root)!==root ||
   statSync(root).uid!==process.getuid() || (statSync(root).mode&0o077)) throw Error('Explicit owner-only native run required');
const config=JSON.parse(readFileSync(path.join(root,'runtime-private.json'),'utf8'));
if(!/^vw-native-[a-f0-9]{12}$/.test(config.identifier)) throw Error('Unowned native run');
async function bridge(item){
  // Input travels through stdin, not command arguments or environment values.
  const child=execFile('python3',[path.resolve(directory,'../native-bridge.py'),'--private-run',root],{env:{PATH:process.env.PATH},maxBuffer:8*1024*1024},()=>{});
  const chunks=[];child.stdout.setEncoding('utf8');child.stdout.on('data',part=>chunks.push(part));
  child.stdin.end(JSON.stringify(item));
  const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
  const result=JSON.parse(chunks.join(''));
  if(code || !result.ok) throw Error(result.error??'Owned native bridge rejected operation');
  return result;
}
export const lit=value=>value==null?'NULL':`'${String(value).replaceAll("'","''")}'`;
export function signedToken(role,claims={},options={}){
  if(!['anon','authenticated','service_role'].includes(role)) throw Error('Role denied');
  const header=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const body=Buffer.from(JSON.stringify({...claims,role,aud:'authenticated',iss:'valorwell-development',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+(options.expires??3600)})).toString('base64url');
  return header+'.'+body+'.'+createHmac('sha256',config.jwt_secret).update(header+'.'+body).digest('base64url');
}
async function wire(service,requestPath,options={}){
  const headers=Object.fromEntries(new Headers(options.headers).entries());
  const result=await bridge({action:'http',request:{service,path:requestPath,method:options.method??'GET',headers,
    body:options.body==null?null:Buffer.from(options.body).toString('base64')}});
  const r=result.http;
  return new Response([204,205,304].includes(r.status)||options.method==='HEAD'?null:Buffer.from(r.body,'base64'),{status:r.status,headers:r.headers});
}
const sessions=new Map();
async function gotrueSession(claims){
  const key=claims.sub+'|'+JSON.stringify(claims.app_metadata??{});
  if(!sessions.has(key)) sessions.set(key,(async()=>{
    const password='Synthetic-'+randomBytes(24).toString('hex');
    const headers={'authorization':'Bearer '+config.service_key,'content-type':'application/json'};
    if(!/^[a-f0-9-]{36}$/i.test(claims.sub)) throw Error('Synthetic UUID identity required');
    // Existing #193 seeds intentionally minimal auth rows for locally signed JWTs.
    // Complete only these synthetic rows so genuine GoTrue can own their sessions.
    await bridge({action:'sql',role:'postgres',sql:`UPDATE auth.users SET instance_id=coalesce(instance_id,'00000000-0000-0000-0000-000000000000'::uuid),aud=coalesce(aud,'authenticated'),role=coalesce(role,'authenticated'),created_at=coalesce(created_at,now()),updated_at=coalesce(updated_at,now()),is_super_admin=coalesce(is_super_admin,false),encrypted_password=coalesce(encrypted_password,''),phone_change=coalesce(phone_change,''),phone_change_token=coalesce(phone_change_token,''),email_change_token_current=coalesce(email_change_token_current,''),reauthentication_token=coalesce(reauthentication_token,''),confirmation_token=coalesce(confirmation_token,''),recovery_token=coalesce(recovery_token,''),email_change_token_new=coalesce(email_change_token_new,''),email_change=coalesce(email_change,''),raw_app_meta_data=coalesce(raw_app_meta_data,'{}'::jsonb),raw_user_meta_data=coalesce(raw_user_meta_data,'{}'::jsonb) WHERE id=${lit(claims.sub)} AND email LIKE '%@example.invalid'; SELECT to_jsonb(true)`});
    let lookup=await wire('auth','/admin/users/'+claims.sub,{headers});
    if(lookup.status===404){
      lookup=await wire('auth','/admin/users',{method:'POST',headers,body:JSON.stringify({id:claims.sub,email:'retest-'+claims.sub+'@example.invalid',password,email_confirm:true,app_metadata:claims.app_metadata??{}})});
    }
    if(![200,201].includes(lookup.status)) throw Error('Fixture identity absent in owned GoTrue');
    const user=await lookup.json();
    if(user.id!==claims.sub) throw Error('GoTrue did not preserve synthetic fixture identity');
    if(!user.email?.endsWith('@example.invalid')) throw Error('Only synthetic email identities allowed');
    const update=await wire('auth','/admin/users/'+claims.sub,{method:'PUT',headers,body:JSON.stringify({password,email_confirm:true,app_metadata:{...user.app_metadata,...claims.app_metadata,provider:'email',providers:['email']}})});
    if(update.status!==200) throw Error('Native synthetic identity preparation failed');
    const login=await wire('auth','/token?grant_type=password',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:user.email,password})});
    const session=await login.json();
    if(login.status!==200 || !session.access_token) throw Error('GoTrue token exchange failed');
    return session.access_token;
  })());
  return sessions.get(key);
}
export async function socketFetch(input,options={}){
  const url=new URL(typeof input==='string'?input:input.url);
  if(url.origin!=='http://127.0.0.1') throw Error('Nonlocal native SDK request denied');
  const service=url.pathname.startsWith('/auth/v1/')?'auth':'rest';
  return wire(service,url.pathname.replace(/^\/(auth|rest)\/v1/,'')+url.search,options);
}
export function gateway(role,claims={},explicitToken){
  const token=explicitToken??signedToken(role,claims);
  const fetch=async(input,options={})=>{
    if(role==='authenticated' && claims.sub && explicitToken===undefined){
      const actual=await gotrueSession(claims);
      options={...options,headers:{...Object.fromEntries(new Headers(options.headers).entries()),authorization:'Bearer '+actual}};
    }
    return socketFetch(input,options);
  };
  return createClient('http://127.0.0.1',token,{global:{fetch},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
}
export function postgresClient({role='service_role'}={}){
  return {async query(sql){return (await bridge({action:'sql',role,sql})).data;}};
}
export function ownedDatabase(){return {literal:lit,async query(sql,role='service_role'){return (await bridge({action:'sql',role,sql})).data;}};}
