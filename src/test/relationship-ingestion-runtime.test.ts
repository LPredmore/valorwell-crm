// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
const tenant='00000000-0000-0000-0000-000000000001';
const org='00000000-0000-0000-0000-000000000002';
const owner='00000000-0000-0000-0000-000000000003';
const opp='00000000-0000-0000-0000-000000000004';
const anchor='10000000-0000-4000-8000-000000000001';
const legacy=readFileSync('supabase/migrations/20260809164922_beyond_the_yellow_lifecycle_orchestration.sql','utf8');
function actualFunction(name:string) {
  const start=legacy.toLowerCase().indexOf(`create or replace function ${name}(`);
  if(start<0) throw new Error(`Missing source ${name}`);
  const end=legacy.indexOf('$function$;',start);
  return legacy.slice(start,end+'$function$;'.length);
}
let db:PGlite;
beforeAll(async()=>{
  db=new PGlite();
  // Minimal synthetic tables. Lifecycle application is a documented no-op;
  // these tests prove actual ingestion/owner/dedup, not opportunity transitions.
  await db.exec(`create schema private;
  create table relationship_opportunities(id uuid,tenant_id uuid,organization_id uuid,owner_profile_id uuid);
  create table relationship_communications(id uuid primary key default gen_random_uuid(),tenant_id uuid,campaign_id uuid,campaign_step_id uuid,enrollment_id uuid,organization_id uuid,contact_id uuid,opportunity_id uuid,direction text,channel text,status text,sender_email text,recipient_email text,subject text,rendered_body text,provider text,provider_message_id text,provider_thread_id text,occurred_at timestamptz,sent_at timestamptz,metadata jsonb);
  create table relationship_message_observations(tenant_id uuid,communication_id uuid,source text,provider_message_id text,provider_thread_id text,rfc_message_id text,observed_at timestamptz,metadata jsonb,unique(tenant_id,source,provider_message_id));
  create table relationship_communication_events(tenant_id uuid,communication_id uuid,provider text,provider_event_id text,event_type text,occurred_at timestamptz,payload jsonb);
  create unique index event_dedup on relationship_communication_events(provider,provider_event_id) where provider_event_id is not null;
  create table relationship_replies(id uuid primary key default gen_random_uuid(),tenant_id uuid,communication_id uuid not null unique,enrollment_id uuid,organization_id uuid,contact_id uuid,opportunity_id uuid,owner_profile_id uuid,status text,metadata jsonb,updated_at timestamptz default now(),follow_up_due_at timestamptz);
  create table relationship_interactions(tenant_id uuid,organization_id uuid,contact_id uuid,opportunity_id uuid,interaction_type text,occurred_at timestamptz,summary text,metadata jsonb);
  create table relationship_campaign_steps(id uuid,tenant_id uuid,stop_on_reply boolean);
  create table relationship_campaign_enrollments(id uuid,tenant_id uuid,status text,responded_at timestamptz,delivery_enabled boolean,next_scheduled_at timestamptz);
  create table private.relationship_campaign_work_items(tenant_id uuid,enrollment_id uuid,status text,claim_token uuid,claimed_by text,claimed_at timestamptz,lease_expires_at timestamptz,updated_at timestamptz,metadata jsonb default '{}');
  create table relationship_enrollment_events(tenant_id uuid,enrollment_id uuid,event_type text,from_status text,to_status text,reason text,metadata jsonb);
  create table relationship_contacts(tenant_id uuid,email text);
  create table private.relationship_delivery_provider_configs(tenant_id uuid,inbound_address text);
  create table private.relationship_google_connections(tenant_id uuid,connection_type text,google_account_email text,status text);
  create function private.relationship_flag_enabled(uuid,text) returns boolean language sql as $$select true$$;
  create function private.find_exact_bty_inbound_candidate(uuid,text,text[],text) returns jsonb language sql as $$select '{"safe":false}'::jsonb$$;
  create function private.apply_relationship_activity(uuid,text,text,text,text,uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,jsonb,uuid) returns jsonb language sql as $$select '{}'::jsonb$$;`);
  for(const name of ['private.relationship_header_value','private.classify_relationship_email','private.ingest_relationship_inbound_reply']) await db.exec(actualFunction(name));
  await db.exec(readFileSync('supabase/migrations/20261018014500_gmail_thread_reply_anchor_direction.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20261021220125_reply_ownership.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20261022001355_relationship_inbound_without_rfc_id.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20261022001106_relationship_gmail_skip_drafts.sql','utf8'));
},60_000);
afterAll(async()=>db?.close());
beforeEach(async()=>{
  await db.exec('truncate relationship_opportunities,relationship_communications,relationship_message_observations,relationship_communication_events,relationship_replies,relationship_interactions,relationship_campaign_enrollments,relationship_enrollment_events,private.relationship_campaign_work_items');
  await db.query('insert into relationship_opportunities values($1,$2,$3,$4)',[opp,tenant,org,owner]);
  await db.query("insert into relationship_communications(id,tenant_id,organization_id,opportunity_id,direction,recipient_email,provider,provider_message_id,occurred_at) values($1,$2,$3,$4,'outbound','sender@example.invalid','gmail','anchor',now())",[anchor,tenant,org,opp]);
  await db.query("insert into relationship_message_observations(tenant_id,communication_id,source,provider_message_id,provider_thread_id,rfc_message_id) values($1,$2,'gmail','anchor','thread','<anchor@example.invalid>')",[tenant,anchor]);
});
async function gmail(labels:string[],from='sender@example.invalid',headers:Record<string,string>={}){
  const r=await db.query<{result:Record<string,unknown>}>("select public.ingest_relationship_gmail_message($1,'message','thread',$2,$3,$4,'Synthetic','Synthetic body',now(),$5) as result",[tenant,{'in-reply-to':'<anchor@example.invalid>',...headers},from,from==='info@valorwell.org'?['sender@example.invalid']:['info@valorwell.org'],labels]);
  return r.rows[0].result;
}
async function resend(event='event',headers={}){
  const r=await db.query<{result:Record<string,unknown>}>("select private.ingest_relationship_inbound_reply('resend',$1,'resend-message','thread',$2,null,'sender@example.invalid','info@valorwell.org','Synthetic','Synthetic body',now(),$3) as result",[event,anchor,{received_headers:headers}]);
  return r.rows[0].result;
}
describe('real ingestion SQL and owner trigger, synthetic dependencies',()=>{
  it('reproduces the old missing-RFC failure against the real NOT NULL communication constraint',async()=>{
    await db.exec('begin');
    try {
      await db.exec(actualFunction('private.ingest_relationship_inbound_reply'));
      await expect(resend()).rejects.toThrow(/null value in column "communication_id"/);
    } finally { await db.exec('rollback'); }
  });
  it('reproduces the old draft-as-sent defect without persisting fixture changes',async()=>{
    await db.exec('begin');
    try {
      await db.exec(readFileSync('supabase/migrations/20261018012500_exact_bty_unanchored_ingest.sql','utf8'));
      expect(await gmail(['DRAFT'],'info@valorwell.org')).toMatchObject({observed:true});
      expect((await db.query("select status from relationship_communications where provider_message_id='message'")).rows).toEqual([{status:'sent'}]);
    } finally { await db.exec('rollback'); }
  });
  it('stops active campaign work on a real human reply insertion',async()=>{
    await db.query("insert into relationship_campaign_enrollments(id,tenant_id,status,delivery_enabled) values($1,$2,'active',true)",[opp,tenant]);
    await db.query('update relationship_communications set enrollment_id=$1 where id=$2',[opp,anchor]);
    await db.query("insert into private.relationship_campaign_work_items(tenant_id,enrollment_id,status) values($1,$2,'planned')",[tenant,opp]);
    await resend();
    expect((await db.query('select status,delivery_enabled,next_scheduled_at from relationship_campaign_enrollments')).rows).toEqual([{status:'responded',delivery_enabled:false,next_scheduled_at:null}]);
    expect((await db.query('select status from private.relationship_campaign_work_items')).rows).toEqual([{status:'cancelled'}]);
  });
  it('never turns a matching Gmail draft into a sent communication, observation or interaction',async()=>{
    expect(await gmail(['DRAFT'],'info@valorwell.org')).toEqual({observed:false,reason:'draft_message'});
    expect((await db.query('select * from relationship_interactions')).rows).toHaveLength(0);
    expect((await db.query('select * from relationship_communications')).rows).toHaveLength(1);
    expect((await db.query('select * from relationship_message_observations')).rows).toHaveLength(1);
  });
  it('captures sent mail once after skipping its draft',async()=>{
    await gmail(['DRAFT'],'info@valorwell.org');
    expect(await gmail(['SENT'],'info@valorwell.org')).toMatchObject({observed:true,deduplicated:false});
    expect(await gmail(['SENT'],'info@valorwell.org')).toMatchObject({observed:true,deduplicated:true});
    expect((await db.query("select * from relationship_communications where provider_message_id='message'")).rows).toHaveLength(1);
    expect((await db.query('select * from relationship_interactions')).rows).toHaveLength(1);
  });
  it.each(['gmail','resend'])('%s without RFC Message-ID inherits ownership and deduplicates repeat deliveries',async(provider)=>{
    const ingest=()=>provider==='gmail'?gmail(['INBOX']):resend();
    await ingest(); await ingest();
    const {rows}=await db.query<{owner_profile_id:string;follow_up_due_at:null}>('select * from relationship_replies');
    expect(rows).toHaveLength(1);expect(rows[0].owner_profile_id).toBe(owner);expect(rows[0].follow_up_due_at).toBeNull();
  });
  it('deduplicates a Resend message even when delivery event ID changes',async()=>{
    await resend('first'); await resend('second');
    expect((await db.query('select * from relationship_replies')).rows).toHaveLength(1);
  });
  it.each(['gmail','resend'])('%s automated messages do not create actionable replies',async(provider)=>{
    if(provider==='gmail') await gmail(['INBOX'],'sender@example.invalid',{'auto-submitted':'auto-replied'});
    else await resend('automated',{'auto-submitted':'auto-replied'});
    expect((await db.query('select * from relationship_replies')).rows).toHaveLength(0);
  });
});
