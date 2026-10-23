// @vitest-environment node
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
const source=readFileSync('scripts/gmail-recovery/relationship-google-sync.candidate.ts','utf8');
const ast=ts.createSourceFile('sync.ts',source,ts.ScriptTarget.Latest,true);
const names=['metadataUrl','processGmailMessage','syncState','updateState','syncGmail','assertGmailRuntimeContract','recordGmailRetrievalFailure'];
const code=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name?.text??'')).map(n=>n.getText(ast).replace('export async function','async function')).join('\n');
function runtime(options: { match?: Record<string,unknown>; ingest?: Record<string,unknown>; fail?: boolean; deleted?: boolean; draftOnFull?: boolean; forbidden?: boolean; wrongId?: boolean; conflictingRfc?: boolean; missingContract?: boolean; missingFailure?: boolean; temporary?: boolean; hasMore?: boolean; quiet?: boolean; receiptFail?: boolean }={}) {
  const header = (from:string,to:string) => ({ headers:[{name:'From',value:from},{name:'To',value:to},{name:'Cc',value:'guest@example.invalid'},{name:'In-Reply-To',value:'<anchor@example.invalid>'},...(options.conflictingRfc?[{name:'Message-ID',value:'<a@example.invalid>'},{name:'Message-ID',value:'<b@example.invalid>'}]:[])] });
  const googleJson=vi.fn(async (url:string) => {
    if(url.includes('/history?')) return options.quiet ? { historyId:'200',history:[] } : { ...(options.hasMore ? { nextPageToken:'next' } : {}), historyId:'200',history:[{id:'199',messagesAdded:[{message:{id:'sent'}},{message:{id:'sent'}},{message:{id:'draft'}}]}] };
    if(options.temporary) throw Object.assign(new Error('temporary provider error'),{status:503});
    if(options.forbidden) throw Object.assign(new Error('permission denied'),{status:403});
    if(options.deleted) throw Object.assign(new Error('deleted'),{status:404});
    return { id:options.wrongId?'wrong':new URL(url).pathname.split('/').pop(), threadId:'thread',internalDate:'0',payload:header(url.includes('format=full')?'authoritative@example.invalid':'metadata@example.invalid','primary@example.invalid'),labelIds:[(url.includes('/draft?') || (options.draftOnFull && url.includes('format=full')))?'DRAFT':'SENT'] };
  });
  const rpc=vi.fn(async (name:string) => {
    if(name==='get_relationship_gmail_runtime_contract') return options.missingContract ? {data:null,error:{code:'PGRST202',message:'missing contract'}} : {data:{contractVersion:1,ready:true},error:null};
    if(name==='record_relationship_gmail_retrieval_failure' && options.missingFailure) return {data:null,error:{code:'PGRST202',message:'missing failure RPC'}};
    if(name==='record_relationship_gmail_source_receipt' && options.receiptFail) return {data:null,error:{message:'receipt persistence failed'}};
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
    expect(rpc).toHaveBeenLastCalledWith('update_relationship_google_sync_state',expect.objectContaining({p_error_code:'gmail_sync_failed'}));
    expect((rpc.mock.calls as unknown as [string,Record<string,unknown>][]).some(c=>c[0]==='update_relationship_google_sync_state' && c[1].p_gmail_history_id)).toBe(false);
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
  it('retains an unavailable message exception without inferring deletion',async()=>{
    const {api,rpc}=runtime({deleted:true});
    expect(await api.processGmailMessage({rpc},'token','gone')).toMatchObject({skipped:'message_not_found'});
    expect(rpc).toHaveBeenCalledWith('record_relationship_gmail_retrieval_failure',{p_message_id:'gone',p_status:'NOT_FOUND'});
  });
  it('preserves the cursor and records permission failures separately from NOT_FOUND',async()=>{
    const {api,rpc}=runtime({forbidden:true});
    await expect(api.syncGmail({rpc},'199')).rejects.toThrow('permission denied');
    expect(rpc).toHaveBeenCalledWith('record_relationship_gmail_retrieval_failure',expect.objectContaining({p_status:'FORBIDDEN'}));
    expect(rpc).toHaveBeenLastCalledWith('update_relationship_google_sync_state',expect.objectContaining({p_error_code:'FORBIDDEN',p_notification:true}));
  });
  it('rejects provider response ID mismatches before persisting receipts or communications',async()=>{
    const {api,rpc}=runtime({wrongId:true});
    await expect(api.processGmailMessage({rpc},'token','sent')).rejects.toThrow('identity mismatch');
    expect(rpc.mock.calls.some(c=>c[0]==='record_relationship_gmail_source_receipt')).toBe(false);
  });

  it('rejects conflicting full RFC headers before flattening or recording a receipt',async()=>{
    const {api,rpc}=runtime({conflictingRfc:true});
    await expect(api.processGmailMessage({rpc},'token','sent')).rejects.toThrow('Conflicting Gmail RFC');
    expect(rpc).toHaveBeenCalledWith('record_relationship_gmail_retrieval_failure',{p_message_id:'sent',p_status:'MISMATCH'});
    expect(rpc.mock.calls.some(c=>c[0]==='record_relationship_gmail_source_receipt')).toBe(false);
  });

});

describe('staged incident worker contract and checkpoint rules',()=>{
  it('fails before provider access on a missing runtime contract without advancing success',async()=>{
    const {api,rpc,googleJson}=runtime({missingContract:true});
    await expect(api.syncGmail({rpc})).rejects.toThrow('Required Gmail database contract');
    expect(googleJson).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenLastCalledWith('update_relationship_google_sync_state',expect.objectContaining({p_error_code:'gmail_contract_missing'}));
    expect(rpc.mock.calls.some(([n,a])=>n==='update_relationship_google_sync_state'&&a?.p_success)).toBe(false);
  });
  it('preserves Google 404 and missing recorder diagnosis and never checkpoints a skipped failure',async()=>{
    const {api,rpc}=runtime({deleted:true,missingFailure:true});
    await expect(api.syncGmail({rpc})).rejects.toThrow('HTTP 404');
    expect(rpc).toHaveBeenLastCalledWith('update_relationship_google_sync_state',expect.objectContaining({p_error_code:'gmail_contract_missing'}));
    expect(rpc.mock.calls.some(([n,a])=>n==='update_relationship_google_sync_state'&&a?.p_gmail_history_id)).toBe(false);
  });
  it('does not advance on temporary Google failure',async()=>{
    const {api,rpc}=runtime({temporary:true});
    await expect(api.syncGmail({rpc})).rejects.toThrow('temporary provider error');
    expect(rpc).toHaveBeenCalledWith('record_relationship_gmail_retrieval_failure',expect.objectContaining({p_status:'UNAVAILABLE'}));
    expect(rpc.mock.calls.some(([n,a])=>n==='update_relationship_google_sync_state'&&a?.p_success)).toBe(false);
  });
  it('does not ingest or checkpoint when authoritative receipt persistence fails',async()=>{
    const {api,rpc}=runtime({receiptFail:true});
    await expect(api.syncGmail({rpc})).rejects.toThrow('receipt persistence failed');
    expect(rpc.mock.calls.some(([n])=>n==='ingest_relationship_gmail_message')).toBe(false);
    expect(rpc.mock.calls.some(([n,a])=>n==='update_relationship_google_sync_state'&&a?.p_success)).toBe(false);
  });
  it('checkpoints only the last processed record on a paginated response',async()=>{
    const {api,rpc}=runtime({hasMore:true});
    expect(await api.syncGmail({rpc})).toMatchObject({hasMore:true,historyId:'199',skippedUnavailable:0,skipped:1});
    expect(rpc).toHaveBeenLastCalledWith('update_relationship_google_sync_state',expect.objectContaining({p_gmail_history_id:'199'}));
  });
  it('records actual no-change provider verification without requiring new mail',async()=>{
    const {api,rpc}=runtime({quiet:true});
    expect(await api.syncGmail({rpc})).toMatchObject({processed:0,hasMore:false,historyId:'200'});
    expect(rpc).toHaveBeenLastCalledWith('update_relationship_google_sync_state',expect.objectContaining({p_success:true}));
  });
  it('propagates ambiguity for durable backfill accounting',async()=>{
    const {api,rpc}=runtime({ingest:{observed:false,ambiguous:true}});
    expect(await api.processGmailMessage({rpc},'token','sent')).toMatchObject({matched:false,ambiguous:true});
  });
});
