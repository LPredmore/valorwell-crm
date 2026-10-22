// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { recoverOriginalSources } from '../../scripts/relationship-email-source-recovery.mjs';
const inventory=[{issueId:'issue',claimedMessageId:'original',threadId:'thread',evidence:{storedRfcIds:['<original@example.invalid>']}}];
describe('read-only exact source recovery',()=>{
 it.each([404,403,500])('distinguishes HTTP %s and never substitutes a later RFC search candidate',async(status)=>{
  const fetcher=vi.fn(async(url:string)=>new Response(JSON.stringify(url.endsWith('profile')?{emailAddress:'info@valorwell.org'}:url.includes('messages?')?{messages:[{id:'later'}]}:{}),{status:url.includes('/messages/original')?status:200}));
  const [row]=await recoverOriginalSources(inventory,'synthetic-token',fetcher);
  expect(row.sourceStatus).toBe(status===404?'NOT_FOUND':status===403?'FORBIDDEN':'UNAVAILABLE');
  expect(row.exactIdentityVerified).toBe(false);expect(row.safelyRepairable).toBe(false);
  expect(row.rfcSearches[0].candidateIds).toEqual(['later']);
  expect(fetcher.mock.calls.every((call)=>call[0].startsWith('https://gmail.googleapis.com/gmail/v1/users/me/'))).toBe(true);
 });
 it.each(['wrong-id','wrong-rfc','wrong-thread','exact'])('checks exact provider identity: %s',async(kind)=>{
  const fetcher=vi.fn(async(url:string)=>new Response(JSON.stringify(url.endsWith('profile')?{emailAddress:'info@valorwell.org'}:{id:kind==='wrong-id'?'later':'original',threadId:kind==='wrong-thread'?'other':'thread',payload:{headers:[{name:'Message-ID',value:kind==='wrong-rfc'?'<later@example.invalid>':'<original@example.invalid>'}]}})));
  const [row]=await recoverOriginalSources(inventory,'synthetic-token',fetcher);
  expect(row.sourceStatus).toBe(kind==='exact'?'VERIFIED_EXACT_PROVIDER_ID':'MISMATCH');
  expect(row.safelyRepairable).toBe(false);
 });
 it('stops before reading messages if mailbox identity cannot be established',async()=>{
  const fetcher=vi.fn(async()=>new Response(JSON.stringify({emailAddress:'other@example.invalid'})));
  await expect(recoverOriginalSources(inventory,'synthetic-token',fetcher)).rejects.toThrow('Authoritative mailbox');
  expect(fetcher).toHaveBeenCalledTimes(1);
 });
});
