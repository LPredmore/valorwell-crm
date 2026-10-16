import test, { before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeStore, pgSupabase, sqliteDurableContext, MemoryBucket } from './storage.mjs';
import { actor, mailbox, rules, reply, followUp, seed, mime, inboundContent } from './fixtures.mjs';
import * as native from './native.mjs';

globalThis.Deno={env:{get:()=>undefined},serve:()=>{}};
let upstream,crm,store,state,originalFetch;
before(async()=>{
 upstream=await import('./generated/upstream.mjs');
 crm=await import('./generated/crm.mjs');
 originalFetch=globalThis.fetch;
});
beforeEach(async()=>{
 store=await makeStore();await seed(store);
 state=globalThis.__inboxSpike={dbClient:pgSupabase(store),upstreamPrompts:[],chatPrompts:[],geminiPrompts:[],network:[],modelFailure:false,
  upstreamDraftArgs:options=>({originalEmailId:state.currentSource,to:'guest@example.test',subject:'Re: Interview invitation',body:reply})};
 globalThis.fetch=async(url,options={})=>{
  url=String(url);state.network.push(url);
  if(url==='https://api.resend.com/emails/receiving/fixture-received-a')return Response.json(inboundContent);
  if(url.startsWith('https://generativelanguage.googleapis.com/')&&url.includes('offline-gemini-fixture')){
   state.geminiPrompts.push(JSON.parse(options.body));
   if(state.modelFailure)return Response.json({error:{message:'scripted upstream outage'}},{status:503});
   return Response.json({candidates:[{content:{parts:[{text:JSON.stringify({replyText:reply})}]}}],usageMetadata:{fixture:true},modelVersion:'scripted-no-inference'});
  }
  throw new Error('Unexpected network operation blocked: '+url);
 };
});
afterEach(async()=>{await store.pg.close();globalThis.fetch=originalFetch;});
after(()=>{delete globalThis.__inboxSpike;});

async function receiveNative(eventId='event-a') {
 const response=await crm.handleInbound(state.dbClient,{type:'email.received'},{email_id:'fixture-received-a'},eventId,'2026-10-16T12:00:00Z','offline-key','fixture-request');
 assert.equal(response.status,200);const payload=await response.json();
 if(payload.emailMessageId)await native.enqueue(store,actor,'tenant-a',payload.emailMessageId);
 return payload;
}
async function makeUpstream({bridge=false,sourceId=null,context=false}={}) {
 const bucket=new MemoryBucket(),contexts=[],objects=new Map();
 const env={BUCKET:bucket,DOMAINS:'example.test',EMAIL_ADDRESSES:[mailbox],
  AI:{async run(model,params){if(state.scannerFailure)throw new Error('scripted scanner outage');if(model.includes('llama-3.1'))return{response:'NO'};return{response:params.messages.at(-1).content}}},
  EMAIL:{async send(){throw new Error('No outgoing email authorized in this spike')}},
  MAILBOX:{idFromName:id=>id,get(id){if(!objects.has(id)){const ctx=sqliteDurableContext(id);contexts.push(ctx);objects.set(id,new upstream.MailboxDO(ctx,env));}return objects.get(id)}},
 };
 const prompt=context?JSON.stringify((await native.crmContext(store,actor,'tenant-a',sourceId)).context):'Draft replies in plain text.';
 await bucket.put('mailboxes/'+mailbox+'.json',JSON.stringify({agentSystemPrompt:prompt}));
 if(bridge)objects.set(mailbox,native.crmMailboxAdapter(store,actor,'tenant-a'));
 const agent=new upstream.EmailAgent({name:mailbox},env);
 env.EMAIL_AGENT={idFromName:id=>id,get:()=>({async fetch(request){const data=await request.json();state.currentSource=data.emailId;await agent.handleNewEmail(data);return Response.json({ok:true});}})};
 return{env,agent,stub:env.MAILBOX.get(mailbox),contexts,close(){contexts.forEach(c=>c.db.close())}};
}
async function receiveUpstream(runtime,body=mime()) {
 const bytes=new TextEncoder().encode(body),pending=[];
 await upstream.receiveEmail({raw:new Blob([bytes]).stream(),rawSize:bytes.byteLength},runtime.env,{waitUntil:p=>pending.push(p)});
 await Promise.all(pending);
}

test('N1: actual CRM inbound handler persists body and correlates outbound reply/client',async()=>{
 const result=await receiveNative();assert.equal(result.clientId,'client-a');
 const row=await native.message(store,actor,'tenant-a',result.emailMessageId);
 assert.equal(row.body_text,inboundContent.text);assert.equal(row.in_reply_to_message_id,'out-a');
});
test('N2: repeated provider webhook creates one message and one drafting job',async()=>{
 const first=await receiveNative();const second=await receiveNative('event-a-redelivery');
 assert.ok(first.emailMessageId);assert.equal(second.duplicate,true);
 // The existing handler intentionally omits emailMessageId on client-email redelivery.
 assert.equal((await store.row("select count(*)::int n from crm_email_messages where provider_message_id='fixture-received-a'")).n,1);
 assert.equal((await store.row('select count(*)::int as n from spike_jobs')).n,1);
});
test('N3: existing inbound logic pauses an active campaign after reply',async()=>{
 await store.insert('crm_campaign_enrollments',{id:'enroll-a',tenant_id:'tenant-a',client_id:'client-a',status:'active'});
 await receiveNative();assert.equal((await store.row('select status from crm_campaign_enrollments')).status,'responded');
});
test('N4: inbox search combines keyword, sender, date and operating tenant',async()=>{
 await receiveNative();const result=await native.search(store,actor,'tenant-a',{query:'interview',from:'guest@example.test',after:'2026-10-16T00:00:00Z'});
 assert.equal(result.length,1);assert.ok(!JSON.stringify(result).includes('SECRET_OTHER_TENANT'));
});
test('N5: thread adapter joins actual CRM reply pointers despite different provider thread IDs',async()=>{
 const input=await receiveNative();const rows=await native.thread(store,actor,'tenant-a',input.emailMessageId);
 assert.equal(rows.length,2);assert.deepEqual(rows.map(r=>r.id),['out-a',input.emailMessageId]);
});
test('N6: native draft runs actual Gemini request helper with CRM context, rules and full thread',async()=>{
 const input=await receiveNative();const draft=await native.processDraft(store,actor,'tenant-a',input.emailMessageId,crm.callGeminiModel);
 assert.equal(draft.body,reply);const prompt=JSON.stringify(state.geminiPrompts[0]);
 assert.match(prompt,/Fixture Veterans Organization/);assert.match(prompt,/BTY_RULE/);assert.match(prompt,/Would you join/);assert.ok(!prompt.includes('SECRET_OTHER'));
});
test('N7: completed draft job is idempotent and does not spend another inference',async()=>{
 const input=await receiveNative();await native.processDraft(store,actor,'tenant-a',input.emailMessageId,crm.callGeminiModel);await native.processDraft(store,actor,'tenant-a',input.emailMessageId,crm.callGeminiModel);
 assert.equal(state.geminiPrompts.length,1);assert.equal((await store.row('select count(*)::int n from spike_drafts')).n,1);
});
test('N8: provider outage is recorded and the same job can recover without losing the incoming email',async()=>{
 const input=await receiveNative();state.modelFailure=true;
 await assert.rejects(native.processDraft(store,actor,'tenant-a',input.emailMessageId,crm.callGeminiModel),/outage/);
 assert.equal((await store.row('select status from spike_jobs')).status,'failed');state.modelFailure=false;
 await native.processDraft(store,actor,'tenant-a',input.emailMessageId,crm.callGeminiModel);
 assert.equal((await store.row('select status from spike_jobs')).status,'completed');
});
test('N9: follow-up action calls actual CRM task repository and preserves due-time offset',async()=>{
 const input=await receiveNative();const task=await native.followUpTask(store,actor,'tenant-a',input.emailMessageId,followUp,crm.supabaseTasksRepository);
 assert.equal(task.clientId,'client-a');assert.equal(task.ownerId,'operator-a');assert.equal(task.dueAt,followUp.dueAt);
 const again=await native.followUpTask(store,actor,'tenant-a',input.emailMessageId,followUp,crm.supabaseTasksRepository);assert.equal(again.id,task.id);
});
test('N10: foreign-tenant reads/actions and unknown action types are rejected',async()=>{
 await assert.rejects(native.message(store,actor,'tenant-b','other-b'),/Forbidden/);
 const input=await receiveNative();await assert.rejects(native.followUpTask(store,actor,'tenant-a',input.emailMessageId,{...followUp,type:'execute_email_instruction'},crm.supabaseTasksRepository),/Unsupported/);
 assert.equal((await store.row('select count(*)::int n from crm_tasks')).n,0);
});

test('U1: unmodified upstream MIME receiver, real SQLite mailbox and agent produce a draft',async()=>{
 const rt=await makeUpstream();try{await receiveUpstream(rt);
 const inbox=await rt.stub.getEmails({folder:'inbox'}),drafts=await rt.stub.getEmails({folder:'draft'});
 assert.equal(inbox.length,1);assert.equal(drafts.length,1);assert.equal(drafts[0].thread_id,inbox[0].thread_id);
 assert.match((await rt.stub.getEmail(drafts[0].id)).body,/example.test\/schedule/);
 }finally{rt.close()}
});
test('U2: actual upstream search, thread retrieval, folder movement and read state work',async()=>{
 const rt=await makeUpstream();try{await receiveUpstream(rt);const inbox=await rt.stub.getEmails({folder:'inbox'});
 const results=await upstream.toolSearchEmails(rt.env,mailbox,{query:'interview'});assert.ok(results.length>=1);
 const history=await upstream.toolGetThread(rt.env,mailbox,inbox[0].thread_id);assert.equal(history.message_count,2);
 await rt.stub.updateEmail(inbox[0].id,{read:true});await rt.stub.moveEmail(inbox[0].id,'archive');
 assert.equal((await rt.stub.getEmails({folder:'archive'})).length,1);
 }finally{rt.close()}
});
test('U3: unmodified inbound path duplicates a re-delivered RFC message (observed integration gap)',async()=>{
 const rt=await makeUpstream();try{await receiveUpstream(rt);await receiveUpstream(rt);
 assert.equal((await rt.stub.getEmails({folder:'inbox'})).length,2);
 assert.equal((await rt.stub.getEmails({folder:'draft'})).length,2);
 }finally{rt.close()}
});
test('U4: unmodified automatic drafting has thread context but lacks CRM context and prior chat corrections',async()=>{
 const rt=await makeUpstream();try{
 rt.agent.messages=[{role:'user',content:'LEARNED_CORRECTION_ALWAYS_USE_MY_SCHEDULING_LINK'}];
 await receiveUpstream(rt);const prompt=JSON.stringify(state.upstreamPrompts[0]);
 assert.ok(!prompt.includes('LEARNED_CORRECTION'));assert.ok(!prompt.includes('Fixture Veterans Organization'));assert.ok(!prompt.includes('BTY_RULE'));
 await rt.agent.onChatMessage(()=>{});assert.match(JSON.stringify(state.chatPrompts[0]),/LEARNED_CORRECTION/);
 }finally{rt.close()}
});
test('U5: stock agent exposes email tools but no CRM task/calendar tools',async()=>{
 const rt=await makeUpstream();try{await receiveUpstream(rt);
 const names=Object.keys(state.upstreamPrompts[0].tools);assert.equal(names.length,9);
 assert.ok(!names.some(x=>/task|calendar|crm/.test(x)));
 }finally{rt.close()}
});
test('U6: shared upstream environment can address another mailbox; CRM authorization must be added',async()=>{
 const rt=await makeUpstream();try{
 const other=rt.env.MAILBOX.get('other@example.test');await other.createEmail('inbox',{id:'private-message',subject:'Other mailbox',sender:'other@example.test',recipient:'other@example.test',date:new Date().toISOString(),body:'Other mailbox content'},[]);
 const data=await upstream.toolGetEmail(rt.env,'other@example.test','private-message');assert.equal(data.body_text,'Other mailbox content');
 }finally{rt.close()}
});
test('U7: scanner outage blocks drafting while retaining incoming email',async()=>{
 const rt=await makeUpstream();try{state.scannerFailure=true;await receiveUpstream(rt);
 assert.equal((await rt.stub.getEmails({folder:'inbox'})).length,1);assert.equal((await rt.stub.getEmails({folder:'draft'})).length,0);
 }finally{rt.close()}
});
test('B1: unchanged upstream tools can search/read canonical CRM records via a scoped adapter',async()=>{
 const input=await receiveNative();const rt=await makeUpstream({bridge:true,sourceId:input.emailMessageId});try{
 const result=await upstream.toolSearchEmails(rt.env,mailbox,{query:'interview'});assert.equal(result.length,2);
 const history=await upstream.toolGetThread(rt.env,mailbox,input.emailMessageId);assert.equal(history.message_count,2);
 const denied=await upstream.toolGetEmail(rt.env,mailbox,'other-b');assert.equal(denied.error,'Email not found');
 }finally{rt.close()}
});
test('B2: unchanged upstream agent can draft onto canonical CRM records with explicitly added CRM context',async()=>{
 const input=await receiveNative();state.currentSource=input.emailMessageId;
 const rt=await makeUpstream({bridge:true,sourceId:input.emailMessageId,context:true});try{
 await rt.agent.handleNewEmail({mailboxId:mailbox,emailId:input.emailMessageId,sender:'guest@example.test',subject:inboundContent.subject,threadId:input.emailMessageId});
 const draft=await store.row('select * from spike_drafts');assert.match(draft.body,/example.test\/schedule/);
 assert.match(JSON.stringify(state.upstreamPrompts[0]),/Fixture Veterans Organization/);assert.match(JSON.stringify(state.upstreamPrompts[0]),/BTY_RULE/);
 }finally{rt.close()}
});
test('B3: original upstream draft ID is preserved by canonical-storage adapter',async()=>{
 const input=await receiveNative();const rt=await makeUpstream({bridge:true,sourceId:input.emailMessageId});try{
 const result=await upstream.toolDraftReply(rt.env,mailbox,{originalEmailId:input.emailMessageId,to:'guest@example.test',subject:'Reply',body:reply,isPlainText:true});
 assert.equal((await store.row('select id from spike_drafts')).id,result.draftId);
 }finally{rt.close()}
});
test('B4: CRM follow-up actions need the same custom task bridge in either architecture',async()=>{
 const input=await receiveNative();const rt=await makeUpstream({bridge:true,sourceId:input.emailMessageId});try{
 await native.followUpTask(store,actor,'tenant-a',input.emailMessageId,followUp,crm.supabaseTasksRepository);
 assert.equal((await store.row('select count(*)::int n from crm_tasks')).n,1);
 assert.equal((await store.row('select count(*)::int n from spike_actions')).n,1);
 }finally{rt.close()}
});
test('B5: email transport is an explicit integration point, not supplied by the mailbox adapter',async()=>{
 const input=await receiveNative();const rt=await makeUpstream({bridge:true,sourceId:input.emailMessageId});try{
 await assert.rejects(rt.stub.createEmail('sent',{id:'unused'},[]),/sending must use CRM transport/);
 assert.ok(!state.network.some(url=>url==='https://api.resend.com/emails'));
 }finally{rt.close()}
});
