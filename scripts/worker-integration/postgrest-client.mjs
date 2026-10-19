import { request as httpRequest } from 'node:http';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const directory = '/workspace/schema-runtime/http';
export function signedToken(role, claims = {}, { expires = 3600 } = {}) {
  if (!['service_role','authenticated','anon'].includes(role)) throw new Error('Invalid acceptance role');
  const secret = readFileSync(directory+'/synthetic-jwt-secret','utf8');
  const header = Buffer.from(JSON.stringify({ alg:'HS256',typ:'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...claims, role, iss:'valorwell-local-acceptance', aud:'authenticated', iat:Math.floor(Date.now()/1000), exp:Math.floor(Date.now()/1000)+expires })).toString('base64url');
  const signature = createHmac('sha256',secret).update(header+'.'+body).digest('base64url');
  return header+'.'+body+'.'+signature;
}
// Actual SDK→HTTP over a Unix socket→network-isolated PostgREST→real PostgreSQL.
// No destination selector, TCP connection or provider endpoint is supported.
export async function socketFetch(url, options = {}) {
  const target = new URL(typeof url === 'string' ? url : url.url);
  if (target.origin !== 'http://127.0.0.1') throw new Error('Nonlocal acceptance request denied');
  const source = typeof url === 'string' ? options : { method:url.method, headers:url.headers, body:await url.text(), ...options };
  const headers = Object.fromEntries(new Headers(source.headers).entries());
  return new Promise((resolve,reject) => {
    const req = httpRequest({ socketPath:directory+'/postgrest.sock', path:target.pathname.replace(/^\/rest\/v1/,'')+target.search, method:source.method??'GET',headers }, (response) => {
      const data=[];response.on('data',(part)=>data.push(part));response.on('error',reject);
      response.on('end',()=>{
        const responseHeaders=new Headers();
        for(const [name,value] of Object.entries(response.headers)) if(value!==undefined) responseHeaders.set(name,Array.isArray(value)?value.join(','):value);
        const status=response.statusCode??500;
        resolve(new Response([204,205,304].includes(status)||source.method==='HEAD'?null:Buffer.concat(data),{status,headers:responseHeaders}));
      });
    });
    req.on('error',reject);req.end(source.body);
  });
}
export function gateway(role, claims = {}, token = signedToken(role,claims)) {
  return createClient('http://127.0.0.1',token,{ global:{fetch:socketFetch},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false} });
}
