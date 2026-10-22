// @vitest-environment node
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
const source=readFileSync('supabase/functions/_shared/relationship-google-sync.ts','utf8');
const ast=ts.createSourceFile('sync.ts',source,ts.ScriptTarget.Latest,true);
const names=['metadataUrl','processGmailMessage','syncState','updateState','syncGmail'];
const code=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name?.text??'')).map(n=>n.getText(ast).replace('export async function','async function')).join('\n');
function runtime(options: { match?: Record<string,unknown>; ingest?: Record<string,unknown>; fail?: boolean; deleted?: boolean; draftOnFull?: boolean }={}) {
  const header = (from:string,to:string) => ({ headers:[{name:'From',value:from},{name:'To',value:to},{name:'Cc',value:'guest@example.invalid'},{name:'In-Reply-To',value:'<anchor@example.invalid>'}] });
  const googleJson=vi.fn(async (url:string) => {
    if(url.includes('/history?')) return { historyId:'200',history:[{id:'199',messagesAdded:[{message:{id:'sent'}},{message:{id:'sent'}},{message:{id:'draft'}}]}] };
    if(options.deleted) throw Object.assign(new Error('deleted'),{status:404});
    return { threadId:'thread',internalDate:'0',payload:header(url.includes('format=full')?'authoritative@example.invalid':'metadata@example.invalid','primary@example.invalid'),labelIds:[(url.includes('/draft?') || (options.draftOnFull && url.includes('format=full')))?'DRAFT':'SENT'] };
  });
  const rpc=vi.fn(async (name:string) => {
    if(name==='get_relationship_google_sync_state') return {data:{gmailHistoryId:'100'},error:null};
    if(name==='match_relationship_gmail_message') return {data:{observationEnabled:true,ambiguous:true,...options.match},error:null};
    if(name==='ingest_relationship_gmail_message') return options.fail?{error:{message:'persistence failed'}}:{data:options.ingest??{observed:false,ambiguous:true},error:null};
    return {data:{},error:null};
  });
  const api=vm.runInNewContext(ts.transpileModule(code+'\n({syncGmail,processGmailMessage});',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{
    TENANT_ID:'synthetic-tenant',GMAIL_MAILBOX:'info@valorwell.org',URLSearchParams,Date,
    googleJson,connectionRuntime:async()=>({id:'connection',googleAccountEmail:'info@valorwell.org'}),refreshGoogleAccessToken:async()=>'synthetic-token',
    headerMap:(p:{headers:{name:string;value:string}[]})=>Object.fromEntries(p.headers.map(h=>[h.name.toLowerCase(),h.value])),
    firstEmail:(s:string)=>s,emailList:(s:string)=>s.split(',').filter(Boolean),gmailBody:()=> 'Full synthetic body',
  });
  return {api,rpc,googleJson};
}
describe('actual Gmail history orchestration with isolated provider and RPC I/O',()=>{
  it('fetches full ambiguous evidence with authoritative sender, To, CC and RFC anchor',async()=>{
    const {api,rpc}=runtime();
    await api.processGmailMessage({rpc},'token','sent');
    expect(rpc).toHaveBeenCalledWith('ingest_relationship_gmail_message',expect.objectContaining({p_from_email:'authoritative@example.invalid',p_to_emails:['primary@example.invalid','guest@example.invalid'],p_body:'Full synthetic body',p_headers:expect.objectContaining({'in-reply-to':'<anchor@example.invalid>'})}));
  });
  it('skips drafts sharing sent-message thread anchors and coalesces repeated IDs',async()=>{
    const {api,rpc}=runtime();
    await api.syncGmail({rpc},'199');
    const calls=rpc.mock.calls as unknown as [string,Record<string,unknown>][];
    expect(calls.filter(c=>c[0]==='ingest_relationship_gmail_message').map(c=>[c[1].p_gmail_message_id,c[1].p_label_ids])).toEqual([['sent',['SENT']]]);
    expect(rpc).toHaveBeenLastCalledWith('update_relationship_google_sync_state',expect.objectContaining({p_gmail_history_id:'200',p_notification:true,p_success:true}));
  });
  it('rechecks full labels if a draft appears after metadata retrieval',async()=>{
    const {api,rpc}=runtime({draftOnFull:true});
    expect(await api.processGmailMessage({rpc},'token','sent')).toMatchObject({skipped:'draft_message'});
    expect(rpc.mock.calls.some(c=>c[0]==='ingest_relationship_gmail_message')).toBe(false);
  });
  it('does not checkpoint failed persistence',async()=>{
    const {api,rpc}=runtime({fail:true});
    await expect(api.syncGmail({rpc},'199')).rejects.toThrow('persistence failed');
    expect(rpc.mock.calls.some(c=>c[0]==='update_relationship_google_sync_state')).toBe(false);
  });
  it('allows push then hourly replay and repeated notification using the same provider IDs',async()=>{
    const {api,rpc}=runtime({ingest:{observed:true,deduplicated:true}});
    await api.syncGmail({rpc},'199'); await api.syncGmail({rpc}); await api.syncGmail({rpc},'199');
    const calls=rpc.mock.calls as unknown as [string,Record<string,unknown>][];
    expect(calls.filter(c=>c[0]==='ingest_relationship_gmail_message').map(c=>c[1].p_gmail_message_id)).toEqual(['sent','sent','sent']);
    // Database uniqueness is tested separately; this suite verifies stable inputs.
  });
  it('skips unrelated mail without fetching its body',async()=>{
    const {api,rpc,googleJson}=runtime({match:{ambiguous:false}});
    expect(await api.processGmailMessage({rpc},'token','unrelated')).toMatchObject({skipped:'unrelated_message'});
    expect(googleJson).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('continues safely when a message was deleted before retrieval',async()=>{
    const {api,rpc}=runtime({deleted:true});
    expect(await api.processGmailMessage({rpc},'token','gone')).toMatchObject({skipped:'message_not_found'});
    expect(rpc).not.toHaveBeenCalled();
  });
});
