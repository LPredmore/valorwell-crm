import { PGlite } from '@electric-sql/pglite';
import { DatabaseSync } from 'node:sqlite';

// A projection of actual CRM columns, not a replacement for its migration/RLS suite.
const schema = `
CREATE TABLE crm_resend_email_settings (tenant_id text primary key, inbound_email text);
CREATE TABLE clients (id text primary key, tenant_id text, email text, pat_name_f text, last_contact_at text, last_contact_channel text, last_contact_direction text);
CREATE TABLE provider_applicants (id text primary key, tenant_id text, email text);
CREATE TABLE crm_email_messages (
 id text primary key default gen_random_uuid()::text, tenant_id text not null, client_id text, provider_applicant_id text,
 campaign_id text, direction text, status text, sender_email text, recipient_email text, subject text,
 body_text text, body_html text, provider text, provider_message_id text, provider_thread_id text,
 in_reply_to_message_id text, source text, received_at text, occurred_at text, created_at text default now()::text,
 unique(tenant_id,provider,provider_message_id));
CREATE TABLE crm_email_events (id text default gen_random_uuid()::text, tenant_id text, email_message_id text,provider text,provider_event_id text unique,event_type text,occurred_at text,payload jsonb);
CREATE TABLE crm_activity_events (id text default gen_random_uuid()::text, tenant_id text,client_id text,event_type text,created_by_profile_id text,metadata jsonb);
CREATE TABLE crm_campaign_enrollments (id text primary key,tenant_id text,client_id text,status text,paused_at text,pause_reason text,updated_at text);
CREATE TABLE crm_tasks (
 id text primary key default gen_random_uuid()::text,tenant_id text not null,title text,description text,client_id text,staff_id text,
 campaign_id text,exception_id text,type text default 'general',priority text default 'normal',status text default 'not_started',
 owner_id text,collaborator_ids jsonb default '[]',relationship_contact_id text,relationship_organization_id text,created_by_profile_id text,
 start_at text,due_at text,completed_at text,recurrence text,checklist jsonb default '[]',tags jsonb default '[]',created_at text default now()::text,updated_at text default now()::text);
CREATE TABLE spike_context (tenant_id text, email text, organization text, operating_rules text,primary key(tenant_id,email));
CREATE TABLE spike_drafts (id text primary key default gen_random_uuid()::text,tenant_id text,source_message_id text,body text,status text default 'draft', unique(tenant_id,source_message_id));
CREATE TABLE spike_jobs (id text primary key default gen_random_uuid()::text,tenant_id text,source_message_id text,status text default 'pending',error text,unique(tenant_id,source_message_id));
CREATE TABLE spike_actions (id text primary key default gen_random_uuid()::text,tenant_id text,source_message_id text,action_key text,task_id text,unique(tenant_id,source_message_id,action_key));
`;

export async function makeStore() {
 const pg = new PGlite(); await pg.exec(schema);
 return {
  pg,
  async row(sql, params=[]) { return (await pg.query(sql,params)).rows[0] ?? null; },
  async rows(sql,params=[]) { return (await pg.query(sql,params)).rows; },
  async insert(table,data) {
   const cols=Object.keys(data); cols.forEach(identifier); identifier(table);
   const values=cols.map(c => typeof data[c]==='object' && data[c]!==null ? JSON.stringify(data[c]) : data[c]);
   return (await pg.query(`insert into ${table} (${cols.join(',')}) values (${cols.map((_,i)=>'$'+(i+1)).join(',')}) returning *`,values)).rows[0];
  }
 };
}
function identifier(s) { if(!/^[a-z_][a-z_0-9]*$/i.test(s)) throw new Error('Invalid SQL identifier'); return s; }

// Executes the subset of PostgREST operations used by the real inbound handler
// and task repository against embedded Postgres instead of a live API.
export function pgSupabase(store) {
 class Query {
  constructor(table) { this.table=identifier(table);this.filters=[];this.params=[];this.mode='select';this.payload=null;this.cap=null; }
  select() { return this; }
  eq(c,v) { this.params.push(v);this.filters.push(`${identifier(c)} = $${this.params.length}`); return this; }
  ilike(c,v) { this.params.push(v);this.filters.push(`${identifier(c)} ilike $${this.params.length}`); return this; }
  in(c,values) { this.filters.push(`${identifier(c)} in (${values.map(v=>{this.params.push(v);return '$'+this.params.length}).join(',')||'NULL'})`);return this; }
  or(expression) { const parts=expression.split(',').map(p=>{const [c,op,...value]=p.split('.');if(op!=='eq')throw new Error('Fixture supports eq OR only');this.params.push(value.join('.'));return `${identifier(c)} = $${this.params.length}`});this.filters.push('('+parts.join(' or ')+')');return this; }
  order() { return this; } limit(n) { this.cap=n;return this; }
  insert(payload) { this.mode='insert';this.payload=payload;return this; }
  update(payload) { this.mode='update';this.payload=payload;return this; }
  async execute(single=false) {
   try {
    let rows;
    if(this.mode==='insert') rows=[await store.insert(this.table,this.payload)];
    else {
     const params=[...this.params];let sql=`select * from ${this.table}`;
     if(this.mode==='update') { const sets=Object.entries(this.payload).map(([c,v])=>{params.push(typeof v==='object'&&v!==null?JSON.stringify(v):v);return `${identifier(c)} = $${params.length}`});sql=`update ${this.table} set ${sets.join(',')}`; }
     if(this.filters.length)sql+=' where '+this.filters.join(' and ');
     if(this.mode==='update')sql+=' returning *';else if(this.cap)sql+=' limit '+Number(this.cap);
     rows=await store.rows(sql,params);
    }
    return { data:single?(rows[0]??null):rows,error:null };
   } catch(e) {return {data:null,error:{message:e.message,code:e.code}}}
  }
  then(ok,bad) {return this.execute().then(ok,bad);}
  maybeSingle() {return this.execute(true);}single() {return this.execute(true);}
 }
 return {from:table=>new Query(table),rpc:async()=>({data:[],error:null}),auth:{getUser:async()=>({data:{user:{id:'operator-a'}}})}};
}

// Node's SQLite implements the SQL cursor/storage surface consumed by the real
// Drizzle Durable Object. This verifies SQL behavior, not Cloudflare deployment.
export function sqliteDurableContext(name) {
 const db=new DatabaseSync(':memory:');
 const cursor=rows=>{let index=0;return {toArray:()=>rows,raw:()=>cursor(rows.map(r=>Object.values(r))),next:()=>index<rows.length?{value:rows[index++],done:false}:{done:true},[Symbol.iterator](){return this}}};
 const storage={
  sql:{exec(sql,...params){
   let rows=[];
   if(!params.length && /;\s*\S/.test(sql.trim().replace(/;$/,''))) db.exec(sql);
   else {const stmt=db.prepare(sql); if(params.length && /\?[0-9]/.test(sql)) {const obj=Object.fromEntries(params.map((p,i)=>[String(i+1),p]));rows=stmt.all(obj);}else rows=stmt.all(...params);}
   return cursor(rows);
  }},
  transactionSync(fn){db.exec('begin');try{const r=fn();db.exec('commit');return r}catch(e){db.exec('rollback');throw e}},
 };
 return {name,storage,db};
}
export class MemoryBucket {
 constructor() {this.items=new Map();}
 async put(key,value) {this.items.set(key,typeof value==='string'?value:new TextDecoder().decode(value));}
 async get(key) {const v=this.items.get(key);return v===undefined?null:{json:async()=>JSON.parse(v),text:async()=>v};}
 async head(key) {return this.items.has(key)?{key}:null;}
 async list({prefix='' }={}) {return{objects:[...this.items.keys()].filter(k=>k.startsWith(prefix)).map(key=>({key}))};}
 async delete(key) {this.items.delete(key);}
}
