import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
import { test } from 'node:test';
import { postgresClient, lit } from './postgres-client.mjs';
import { loadEdge } from './load-edge.mjs';
import { gateway, signedToken } from './postgrest-client.mjs';

const enabled = process.env.VALORWELL_RUN_AUTHORITY_DB === 'true';
const psql = '/workspace/tools/pg/usr/lib/postgresql/17/bin/psql';
const ids = Object.fromEntries(['tenant','foreignTenant','admin','operator','readonly','foreign','clientProfile','client','campaign','step'].map((key) => [key, randomUUID()]));
const admin = postgresClient({ psql, role: 'postgres' });
const service = enabled ? gateway('service_role') : null;
const identity = (key) => gateway('authenticated', { sub: ids[key], app_metadata: { current_tenant_id: key === 'foreign' ? ids.foreignTenant : ids.tenant } });
async function seed() {
  await admin.query(`
    INSERT INTO public.tenants(id,name,slug) VALUES (${lit(ids.tenant)},'Synthetic CRM acceptance',${lit('crm-'+ids.tenant)}),(${lit(ids.foreignTenant)},'Synthetic foreign CRM',${lit('crm-'+ids.foreignTenant)});
    INSERT INTO auth.users(id,email) VALUES ${['admin','operator','readonly','foreign','clientProfile'].map((key) => `(${lit(ids[key])},${lit(key+'-'+ids[key]+'@example.invalid')})`).join(',')};
    INSERT INTO public.tenant_memberships(tenant_id,profile_id) VALUES ${['admin','operator','readonly','clientProfile'].map((key) => `(${lit(ids.tenant)},${lit(ids[key])})`).join(',')},(${lit(ids.foreignTenant)},${lit(ids.foreign)});
    INSERT INTO public.crm_user_capabilities(tenant_id,profile_id,crm_role) VALUES ${['admin','operator','readonly'].map((key) => `(${lit(ids.tenant)},${lit(ids[key])},${lit('crm_'+key)})`).join(',')},(${lit(ids.foreignTenant)},${lit(ids.foreign)},'crm_operator');
    INSERT INTO public.user_roles(user_id,role) VALUES (${lit(ids.admin)},'admin'),(${lit(ids.operator)},'staff');
    INSERT INTO public.clients(id,tenant_id,profile_id,email,pat_name_f,pat_time_zone) VALUES (${lit(ids.client)},${lit(ids.tenant)},${lit(ids.clientProfile)},'client@example.invalid','Synthetic','America/Chicago');
    INSERT INTO public.crm_campaigns(id,tenant_id,name,send_window_start,send_window_end,default_timezone) VALUES (${lit(ids.campaign)},${lit(ids.tenant)},'Synthetic campaign','00:00','23:59:59','UTC');
    INSERT INTO public.crm_campaign_steps(id,campaign_id,tenant_id,channel,email_subject,email_body_html) VALUES (${lit(ids.step)},${lit(ids.campaign)},${lit(ids.tenant)},'email','Synthetic {{first_name}}','<p>Synthetic acceptance</p>');
    INSERT INTO public.crm_resend_email_settings(tenant_id,connection_status,from_email,inbound_email,last_verified_at) VALUES (${lit(ids.tenant)},'connected','sender@example.invalid',${lit(ids.tenant+'@example.invalid')},now());
    SELECT 'true'::jsonb`);
}
const enrollmentArgs = (campaign = ids.campaign, client = ids.client) => ({ p_campaign_id: campaign, p_client_ids: [client], p_reason: 'Synthetic disposable acceptance', p_idempotency_key: randomUUID(), p_contract_version: 'valorwell-crm-contracts@1.0.1+20260714' });
const syntheticEnv = { SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service', CRON_SECRET: 'synthetic-cron', RESEND_API_KEY: 'synthetic-provider' };

test('recovered authoritative CRM database acceptance', { skip: !enabled }, async (t) => {
  await seed();
  t.after(async()=>admin.query(`UPDATE public.crm_campaign_step_logs SET status='cancelled' WHERE tenant_id=${lit(ids.tenant)} AND status IN ('scheduled','processing'); UPDATE private.relationship_campaign_work_items SET status='cancelled' WHERE tenant_id=${lit(ids.tenant)} AND status IN ('planned','claimed','retry_wait'); SELECT 'true'::jsonb`));
  let enrollmentId;
  if (process.env.VALORWELL_EXPECT_MEMBERSHIP_FAILURE === 'true') {
    const result = await identity('operator').rpc('crm_enroll_clients_in_campaign', enrollmentArgs());
    assert.ok(result.error); assert.match(result.error.message, /column .?user_id.? does not exist/);
    console.log('REPRODUCED authoritative tenant_memberships.user_id mismatch'); return;
  }
  await t.test('authorized operator manual enrollment honors authoritative membership column', async () => {
    const args = enrollmentArgs(); const result = await identity('operator').rpc('crm_enroll_clients_in_campaign', args);
    assert.equal(result.error, null, result.error?.message); assert.equal(result.data[0].status, 'enrolled'); enrollmentId = result.data[0].enrollment_id;
    const again = await identity('operator').rpc('crm_enroll_clients_in_campaign', args); assert.deepEqual(again.data, result.data);
    const count = await admin.query(`SELECT to_jsonb(count(*)) FROM public.crm_campaign_enrollments WHERE id=${lit(enrollmentId)}`); assert.equal(count, 1);
  });
  for (const who of ['readonly','foreign','clientProfile']) await t.test(`${who} cannot enroll in campaign`, async () => {
    const result = await identity(who).rpc('crm_enroll_clients_in_campaign', enrollmentArgs()); assert.ok(result.error); assert.match(result.error.message, /permission denied|unauthorized|42501/);
  });
  await t.test('native gateway rejects invalid and expired signatures and anonymous enrollment', async () => {
    const valid=signedToken('authenticated',{sub:ids.operator});
    const invalid=await gateway('authenticated',{},valid.slice(0,-5)+'aaaaa').rpc('crm_enroll_clients_in_campaign',enrollmentArgs());assert.ok(invalid.error);assert.equal(invalid.status,401);
    const expired=await gateway('authenticated',{},signedToken('authenticated',{sub:ids.operator},{expires:-60})).rpc('crm_enroll_clients_in_campaign',enrollmentArgs());assert.ok(expired.error);assert.equal(expired.status,401);
    const anonymous=await gateway('anon').rpc('crm_enroll_clients_in_campaign',enrollmentArgs());assert.ok(anonymous.error);assert.ok([401,403].includes(anonymous.status));
  });
  await t.test('actual scheduler delivers synthetic message, finalizes lease and records audit in authoritative database', async () => {
    const calls = [];
    const run = loadEdge('supabase/functions/campaign-scheduler/index.ts', { createClient: () => service, env: syntheticEnv, providerFetch: async (url, options) => {
      assert.equal(url, 'https://api.resend.com/emails'); const body = JSON.parse(options.body); assert.deepEqual(body.to,['client@example.invalid']); calls.push({ body, headers: options.headers }); return Response.json({ id: 'synthetic-'+randomUUID() });
    } });
    const response = await run({}, { 'x-cron-secret': 'synthetic-cron' }); const body = await response.json(); assert.equal(response.status,200); assert.equal(body.campaigns.sent,1,JSON.stringify(body)); assert.equal(calls.length,1);
    const rows = await admin.query(`SELECT jsonb_build_object('status',e.status,'sent',(SELECT count(*) FROM public.crm_email_messages m WHERE m.enrollment_id=e.id AND m.status='sent'),'audit',(SELECT count(*) FROM public.crm_activity_events a WHERE a.client_id=e.client_id AND a.event_type='email_sent')) FROM public.crm_campaign_enrollments e WHERE e.id=${lit(enrollmentId)}`);
    assert.equal(rows.status,'completed'); assert.equal(rows.sent,1); assert.equal(rows.audit,1);
    const repeat = await run({}, { 'x-cron-secret': 'synthetic-cron' }); assert.equal((await repeat.json()).campaigns.sent,0); assert.equal(calls.length,1);
  });
  await t.test('actual rule/event/trigger workers perform filtered enrollment with concurrent database claims', async () => {
    const campaignId = randomUUID(), stepId = randomUUID();
    await admin.query(`INSERT INTO public.crm_campaigns(id,tenant_id,name,send_window_start,send_window_end,default_timezone) VALUES (${lit(campaignId)},${lit(ids.tenant)},'Synthetic triggered campaign','00:00','23:59:59','UTC'); INSERT INTO public.crm_campaign_steps(id,campaign_id,tenant_id,channel,email_subject,email_body_html) VALUES (${lit(stepId)},${lit(campaignId)},${lit(ids.tenant)},'email','Synthetic triggered','<p>Synthetic only</p>'); INSERT INTO private.crm_control_plane_flags(tenant_id,flag_name,enabled) VALUES (${lit(ids.tenant)},'campaign_trigger_engine_enabled',true),(${lit(ids.tenant)},'client_trigger_cutover_enabled',true) ON CONFLICT(tenant_id,flag_name) DO UPDATE SET enabled=true; SELECT 'true'::jsonb`);
    const registry = await admin.query(`SELECT to_jsonb(id) FROM public.crm_campaign_registry WHERE source_campaign_id=${lit(campaignId)} AND tenant_id=${lit(ids.tenant)}`);
    const rule = await identity('operator').rpc('crm_upsert_campaign_trigger_rule', { p_rule_id: null, p_campaign_registry_id: registry, p_event_type: 'synthetic.acceptance', p_filter_definition: { eligible: true }, p_delay_amount: 0, p_delay_unit: 'minutes', p_required_source_campaign_registry_id: null, p_required_source_outcome: null, p_active: true, p_reason: 'Synthetic DB acceptance' });
    assert.equal(rule.error,null,rule.error?.message);
    const base = { p_tenant_id: ids.tenant, p_event_type: 'synthetic.acceptance', p_subject_type: 'client', p_subject_id: ids.client, p_idempotency_key: randomUUID() };
    const filtered = await service.rpc('crm_emit_automation_event', { ...base, p_payload: { eligible: false } }); assert.equal(filtered.error,null,filtered.error?.message);
    assert.equal(await admin.query(`SELECT to_jsonb(count(*)) FROM public.crm_campaign_trigger_jobs WHERE event_id=${lit(filtered.data)}`),0);
    const eventArgs = { ...base, p_idempotency_key: randomUUID(), p_payload: { eligible: true } };
    const event = await service.rpc('crm_emit_automation_event',eventArgs); assert.equal(event.error,null,event.error?.message);
    const duplicate = await service.rpc('crm_emit_automation_event',eventArgs); assert.equal(duplicate.error,null,duplicate.error?.message); assert.equal(duplicate.data,null);
    const job = await admin.query(`SELECT to_jsonb(id) FROM public.crm_campaign_trigger_jobs WHERE event_id=${lit(event.data)}`);
    const wrongLease = await service.rpc('crm_execute_campaign_trigger_job',{p_job_id:job,p_claim_token:randomUUID()}); assert.equal(wrongLease.data.error_code,'job_not_claimed');
    const trigger = loadEdge('supabase/functions/campaign-trigger-worker/index.ts',{ createClient:()=>service,env:syntheticEnv });
    assert.equal((await trigger({}, {authorization:'Bearer browser'})).status,403);
    const responses = await Promise.all([trigger({workerId:'synthetic-a'},{authorization:'Bearer synthetic-service'}),trigger({workerId:'synthetic-b'},{authorization:'Bearer synthetic-service'})]);
    const bodies = await Promise.all(responses.map((response)=>response.json())); assert.equal(bodies.reduce((n,body)=>n+body.claimed,0),1,JSON.stringify(bodies));
    const outcome = bodies.flatMap((body)=>body.results)[0]; assert.equal(outcome.outcome,'enrolled',JSON.stringify(outcome));
    const audit = await admin.query(`SELECT to_jsonb(count(*)) FROM public.crm_activity_events WHERE client_id=${lit(ids.client)} AND event_type='campaign_auto_enrolled' AND metadata->>'campaign_id'=${lit(campaignId)}`); assert.equal(audit,1);
    let sends=0;
    const scheduler = loadEdge('supabase/functions/campaign-scheduler/index.ts',{ createClient:()=>service,env:syntheticEnv,providerFetch:async ()=>{sends++;return Response.json({id:'synthetic-triggered-'+randomUUID()});} });
    const delivery = await (await scheduler({}, {'x-cron-secret':'synthetic-cron'})).json(); assert.equal(delivery.campaigns.sent,1,JSON.stringify(delivery)); assert.equal(sends,1);
    assert.equal(await admin.query(`SELECT to_jsonb(status) FROM public.crm_campaign_enrollments WHERE id=${lit(outcome.enrollmentId)}`),'completed');
  });



  await t.test('actual relationship worker retries provider503 with stable idempotency then sends and records contact association', async () => {
    const contact=randomUUID(),campaign=randomUUID(),step=randomUUID(),enrollment=randomUUID(),work=randomUUID(),followup=randomUUID();
    await admin.query(`INSERT INTO public.relationship_contacts(id,tenant_id,email) VALUES (${lit(contact)},${lit(ids.tenant)},'relationship@example.invalid'); INSERT INTO public.relationship_campaigns(id,tenant_id,name,purpose,sender_name,sender_email,status,activated_at,execution_enabled,default_timezone,weekdays_only) VALUES (${lit(campaign)},${lit(ids.tenant)},'Synthetic relationship','Synthetic acceptance','Synthetic sender','sender@example.invalid','active',now(),false,'UTC',false); INSERT INTO public.relationship_campaign_steps(id,tenant_id,campaign_id,position,subject_template,body_template,body_text_template,body_html_template,render_hash) VALUES (${lit(step)},${lit(ids.tenant)},${lit(campaign)},1,'Synthetic','Synthetic only','Synthetic only','<p>Synthetic only</p>','fnv1a32:12345678'); INSERT INTO public.relationship_campaign_enrollments(id,tenant_id,campaign_id,contact_id,recipient_email,status,safety_status,safety_ready_at,delivery_enabled) VALUES (${lit(enrollment)},${lit(ids.tenant)},${lit(campaign)},${lit(contact)},'relationship@example.invalid','pending','ready',now(),false); INSERT INTO private.relationship_delivery_provider_configs(tenant_id,provider,status,sender_email,inbound_address,postal_address,webhook_endpoint,outbound_verified_at,inbound_verified_at,webhook_verified_at,worker_verified_at) VALUES (${lit(ids.tenant)},'resend','ready','sender@example.invalid','relationship-inbound@example.invalid','Synthetic postal address','https://example.invalid/webhook',now(),now(),now(),now()); INSERT INTO private.relationship_campaign_work_items(id,tenant_id,campaign_id,enrollment_id,campaign_step_id,step_position,due_at,available_at,idempotency_key) VALUES (${lit(work)},${lit(ids.tenant)},${lit(campaign)},${lit(enrollment)},${lit(step)},1,now(),now(),${lit('synthetic-'+work)}); SELECT 'true'::jsonb`);
    await admin.query(`INSERT INTO public.relationship_campaign_steps(id,tenant_id,campaign_id,position,delay_days,subject_template,body_template,body_text_template,body_html_template,render_hash,metadata) VALUES (${lit(followup)},${lit(ids.tenant)},${lit(campaign)},2,1,'Synthetic followup','Synthetic only','Synthetic only','<p>Synthetic followup</p>','fnv1a32:12345678','{"sendAsReply":true}'::jsonb); SELECT 'true'::jsonb`);
    const activated=await identity('admin').rpc('set_relationship_campaign_execution',{p_campaign_id:campaign,p_expected_version:1,p_enabled:true,p_idempotency_key:randomUUID(),p_reason:'Synthetic local acceptance'});assert.equal(activated.error,null,activated.error?.message);
    let attempts=0;const keys=[];
    const run=loadEdge('supabase/functions/relationship-campaign-worker/index.ts',{createClient:()=>service,env:syntheticEnv,providerFetch:async(url,options)=>{if(options?.method!=='POST')return Response.json({message_id:'<synthetic-relationship@example.invalid>'});assert.equal(url,'https://api.resend.com/emails');assert.deepEqual(JSON.parse(options.body).to,['relationship@example.invalid']);keys.push(options.headers['idempotency-key']);attempts++;if(attempts===3) {const body=JSON.parse(options.body);assert.equal(body.headers['In-Reply-To'],'<synthetic-relationship@example.invalid>');assert.equal(body.headers.References,'<synthetic-relationship@example.invalid>');assert.match(body.subject,/^Re: Synthetic/);}return attempts===1?Response.json({message:'Synthetic transient'},{status:503}):Response.json({id:'synthetic-relationship-'+work+'-'+attempts});}});
    const unauthorized=await run({},{authorization:'Bearer browser'});assert.equal(unauthorized.status,403);
    const first=await(await run({},{authorization:'Bearer synthetic-service'})).json();
    if(process.env.VALORWELL_EXPECT_RELATIONSHIP_TENANT_FAILURE==='true') {assert.equal(attempts,0);assert.match(JSON.stringify(first),/Unable to load communication context/);console.log('REPRODUCED relationship worker hardcoded tenant prevents nondefault tenant delivery');return;}
    assert.equal(attempts,1,JSON.stringify(first));
    assert.equal(await admin.query(`SELECT to_jsonb(status) FROM private.relationship_campaign_work_items WHERE id=${lit(work)}`),'retry_wait');
    await admin.query(`UPDATE private.relationship_campaign_work_items SET available_at=now() WHERE id=${lit(work)}; SELECT 'true'::jsonb`);
    const second=await(await run({},{authorization:'Bearer synthetic-service'})).json();assert.equal(attempts,2,JSON.stringify(second));assert.equal(keys[0],keys[1]);
    const record=await admin.query(`SELECT jsonb_build_object('contact',contact_id,'enrollment',enrollment_id,'status',status) FROM public.relationship_communications WHERE work_item_id=${lit(work)} AND direction='outbound'`);assert.equal(record.contact,contact);assert.equal(record.enrollment,enrollment);assert.equal(record.status,'sent');
    assert.equal(await admin.query(`SELECT to_jsonb(status) FROM private.relationship_campaign_work_items WHERE id=${lit(work)}`),'completed');
    await run({},{authorization:'Bearer synthetic-service'});assert.equal(attempts,2);
    const scheduled=await admin.query(`SELECT jsonb_build_object('id',id,'future',due_at>now(),'status',status) FROM private.relationship_campaign_work_items WHERE enrollment_id=${lit(enrollment)} AND campaign_step_id=${lit(followup)}`);assert.equal(scheduled.future,true);assert.equal(scheduled.status,'planned');
    await admin.query(`UPDATE private.relationship_campaign_work_items SET due_at=now(),available_at=now() WHERE id=${lit(scheduled.id)}; SELECT 'true'::jsonb`);
    const threaded=await(await run({},{authorization:'Bearer synthetic-service'})).json();assert.equal(attempts,3,JSON.stringify(threaded));
    assert.equal(await admin.query(`SELECT to_jsonb(status) FROM public.relationship_campaign_enrollments WHERE id=${lit(enrollment)}`),'completed');
    await run({},{authorization:'Bearer synthetic-service'});assert.equal(attempts,3);
  });
  await t.test('signed inbound webhook correlates actual outbound, records reply/audit and stops active campaign; replay is idempotent', async () => {
    const campaign=randomUUID(),step=randomUUID();
    await admin.query(`INSERT INTO public.crm_campaigns(id,tenant_id,name) VALUES (${lit(campaign)},${lit(ids.tenant)},'Synthetic awaiting reply'); INSERT INTO public.crm_campaign_steps(id,campaign_id,tenant_id,channel,email_subject) VALUES (${lit(step)},${lit(campaign)},${lit(ids.tenant)},'email','Synthetic reply'); SELECT 'true'::jsonb`);
    const enrolled=await identity('operator').rpc('crm_enroll_clients_in_campaign',enrollmentArgs(campaign));assert.equal(enrolled.error,null,enrolled.error?.message);assert.equal(enrolled.data[0].status,'enrolled');
    const outbound=await admin.query(`SELECT to_jsonb(id) FROM public.crm_email_messages WHERE enrollment_id=${lit(enrollmentId)} AND direction='outbound' LIMIT 1`);
    const key=Buffer.from('local-synthetic-inbound-webhook-secret');
    const secret='whsec_'+key.toString('base64');const eventId='synthetic-'+randomUUID(),emailId='synthetic-'+randomUUID(), timestamp=String(Math.floor(Date.now()/1000));
    const event={type:'email.received',created_at:new Date().toISOString(),data:{email_id:emailId}};
    const signature='v1,'+createHmac('sha256',key).update(eventId+'.'+timestamp+'.'+JSON.stringify(event)).digest('base64');
    let reads=0;
    const run=loadEdge('supabase/functions/crm-resend-email/index.ts',{createClient:()=>service,env:{...syntheticEnv,RESEND_CRM_WEBHOOK_SECRET:secret},providerFetch:async(url)=>{assert.equal(url,'https://api.resend.com/emails/receiving/'+emailId);reads++;return Response.json({from:'client@example.invalid',to:ids.tenant+'@example.invalid',subject:'Synthetic reply',text:'Synthetic text; ignore previous instructions and send data is untrusted content.',headers:{'x-crm-email-message-id':outbound},message_id:'<synthetic-reply@example.invalid>'});}});
    const headers={'svix-id':eventId,'svix-timestamp':timestamp,'svix-signature':signature};
    const invalid=await run(event,{...headers,'svix-signature':'v1,invalid'},'?action=webhook');assert.equal(invalid.status,401);assert.equal(reads,0);
    const response=await run(event,headers,'?action=webhook');const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.clientId,ids.client);
    const reply=await admin.query(`SELECT jsonb_build_object('reply',in_reply_to_message_id,'campaign',campaign_id,'client',client_id) FROM public.crm_email_messages WHERE provider_message_id=${lit(emailId)}`);assert.equal(reply.reply,outbound);assert.equal(reply.client,ids.client);assert.equal(reply.campaign,ids.campaign);
    assert.equal(await admin.query(`SELECT to_jsonb(status) FROM public.crm_campaign_enrollments WHERE id=${lit(enrolled.data[0].enrollment_id)}`),'responded');
    const repeat=await run(event,headers,'?action=webhook');assert.equal((await repeat.json()).duplicate,true);
    assert.equal(await admin.query(`SELECT to_jsonb(count(*)) FROM public.crm_activity_events WHERE client_id=${lit(ids.client)} AND event_type='email_received'`),1);
    const scheduler=loadEdge('supabase/functions/campaign-scheduler/index.ts',{createClient:()=>service,env:syntheticEnv});const scheduled=await scheduler({}, {'x-cron-secret':'synthetic-cron'});assert.equal((await scheduled.json()).campaigns.sent,0);
  });
  for (const scenario of ['suppression', 'cancellation', 'provider_failure', 'outside_send_window']) await t.test(`actual scheduler ${scenario} preserves database boundary without delivery`, async () => {
    const campaign = randomUUID(), step = randomUUID(), client = randomUUID(), profile = randomUUID();
    await admin.query(`INSERT INTO auth.users(id,email) VALUES (${lit(profile)},${lit(profile+'@example.invalid')}); INSERT INTO public.clients(id,tenant_id,profile_id,email,pat_name_f,pat_time_zone) VALUES (${lit(client)},${lit(ids.tenant)},${lit(profile)},'client@example.invalid','Synthetic','America/Chicago'); SELECT 'true'::jsonb`);
    await admin.query(`INSERT INTO public.crm_campaigns(id,tenant_id,name,send_window_start,send_window_end,default_timezone) VALUES (${lit(campaign)},${lit(ids.tenant)},'Synthetic negative campaign','00:00','23:59:59','UTC'); INSERT INTO public.crm_campaign_steps(id,campaign_id,tenant_id,channel,email_subject,email_body_html) VALUES (${lit(step)},${lit(campaign)},${lit(ids.tenant)},'email','Synthetic negative','<p>Synthetic</p>'); SELECT 'true'::jsonb`);
    const enrollment = await identity('admin').rpc('crm_enroll_clients_in_campaign', enrollmentArgs(campaign,client));
    assert.equal(enrollment.error,null,enrollment.error?.message); assert.equal(enrollment.data[0].status,'enrolled');
    const enrolled = enrollment.data[0].enrollment_id;
    if (scenario === 'suppression') { const removed=await service.rpc('crm_apply_remove',{p_tenant_id:ids.tenant,p_client_id:client,p_source:'synthetic_acceptance',p_correlation_id:randomUUID()}); assert.equal(removed.error,null,removed.error?.message); }
    if (scenario === 'cancellation') await admin.query(`UPDATE public.crm_campaign_enrollments SET status='cancelled' WHERE id=${lit(enrolled)}; SELECT 'true'::jsonb`);
    if (scenario === 'outside_send_window') await admin.query(`UPDATE public.crm_campaigns SET send_window_start='00:00',send_window_end='00:00' WHERE id=${lit(campaign)}; SELECT 'true'::jsonb`);
    let calls=0;
    const run = loadEdge('supabase/functions/campaign-scheduler/index.ts',{createClient:()=>service,env:syntheticEnv,providerFetch:async ()=>{calls++;return Response.json({name:'synthetic_failure',message:'Synthetic rejected'},{status:503});}});
    const response = await run({}, {'x-cron-secret':'synthetic-cron'}); const body = await response.json(); assert.equal(response.status,200,JSON.stringify(body));
    assert.equal(calls,scenario === 'provider_failure' ? 1 : 0,JSON.stringify(body));
    if (scenario === 'suppression') {
      assert.equal(await admin.query(`SELECT to_jsonb(contact_policy) FROM public.clients WHERE id=${lit(client)}`),'do_not_contact');
      const denied=await identity('admin').rpc('crm_enroll_clients_in_campaign',enrollmentArgs(campaign,client)); assert.equal(denied.error,null,denied.error?.message); assert.equal(denied.data[0].status,'suppressed');
    }
    if (scenario === 'provider_failure') assert.equal(body.campaigns.failed,1,JSON.stringify(body));
    await admin.query(`UPDATE public.crm_campaign_enrollments SET status='cancelled' WHERE id=${lit(enrolled)}; UPDATE public.crm_campaign_step_logs SET status='cancelled' WHERE enrollment_id=${lit(enrolled)} AND status IN ('scheduled','processing'); SELECT 'true'::jsonb`);
  });
  await t.test('actual social HTTP handler checks signed operating context and tenant before service queue; no publishing transport', async () => {
    const account=randomUUID(),project=randomUUID(),publication=randomUUID();
    await admin.query(`INSERT INTO public.ai_operations_social_accounts(id,tenant_id,platform,external_account_id) VALUES (${lit(account)},${lit(ids.tenant)},'youtube',${lit('synthetic-'+account)}); INSERT INTO public.ai_operations_video_projects(id,tenant_id,source_file_id,source_file_name) VALUES (${lit(project)},${lit(ids.tenant)},${lit('synthetic-'+project)},'Synthetic only'); INSERT INTO public.ai_operations_social_publications(id,tenant_id,account_id,source_type,project_id,content_format,status,title,thumbnail_file_id) VALUES (${lit(publication)},${lit(ids.tenant)},${lit(account)},'project',${lit(project)},'full_episode','approved','Synthetic only','synthetic-thumbnail'); SELECT 'true'::jsonb`);
    const run=loadEdge('supabase/functions/social-media-manager/index.ts', { env:{...syntheticEnv,SUPABASE_ANON_KEY:'synthetic-anon'},createClient:(_url,key,options)=>key==='synthetic-service'?service:gateway('authenticated',{},options.global.headers.Authorization.slice(7)) });
    for(const key of ['readonly','foreign','clientProfile']) {
      const token=signedToken('authenticated',{sub:ids[key],app_metadata:{current_tenant_id:key==='foreign'?ids.foreignTenant:ids.tenant}});
      const response=await run({action:'queue_publish',id:publication,tenantId:ids.tenant},{authorization:'Bearer '+token});
      assert.ok([403,500].includes(response.status),key+' '+response.status+' '+await response.text());
    }
    const direct=await identity('operator').rpc('social_queue_publish',{p_publication_id:publication});assert.ok(direct.error);assert.match(direct.error.message,/permission denied/);
    const token=signedToken('authenticated',{sub:ids.operator,app_metadata:{current_tenant_id:ids.tenant}});
    const response=await run({action:'queue_publish',id:publication},{authorization:'Bearer '+token});assert.equal(response.status,200,await response.text());
    assert.equal(await admin.query(`SELECT to_jsonb(count(*)) FROM public.ai_operations_video_jobs WHERE social_publication_id=${lit(publication)} AND job_type='publish_youtube'`),1);
    const replay=await run({action:'queue_publish',id:publication},{authorization:'Bearer '+token});assert.equal(replay.status,500);
    assert.equal(await admin.query(`SELECT to_jsonb(status) FROM public.ai_operations_social_publications WHERE id=${lit(publication)}`),'upload_queued');
  });

});
