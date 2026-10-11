import {describe,it,expect} from 'vitest';
import {
 canAttemptDelivery,classifyResendResponse,normalizeEmail,taggedReplyTo,
 renderRecruitmentEmail,
} from '../../supabase/functions/recruitment-delivery-worker/delivery-utils';

describe('recruitment delivery worker fail-closed behavior',()=>{
 it('refuses provider calls until runtime, DB controls and per-message claim ALL approve',()=>{
  for(const runtimeEnabled of [false,true])
   for(const databaseEnabled of [false,true])
    for(const claimValid of [false,true])
     expect(canAttemptDelivery({runtimeEnabled,databaseEnabled,claimValid}))
      .toBe(runtimeEnabled&&databaseEnabled&&claimValid);
 });
 it('does not blindly retry ambiguous provider results',()=>{
  expect(classifyResendResponse(200,{id:'provider-id'})).toBe('accepted');
  expect(classifyResendResponse(429,{name:'rate_limit'})).toBe('retry');
  expect(classifyResendResponse(503,{message:'backend unavailable'})).toBe('uncertain');
  expect(classifyResendResponse(200,null,true)).toBe('uncertain');
  expect(classifyResendResponse(400,{message:'bad_request'})).toBe('failed');
  expect(classifyResendResponse(200,{})).toBe('failed');
 });
 it('generates CRM-tagged inbound reply routes',()=>{
  expect(taggedReplyTo('replies+old@receive.resend.app','a8373f16-6062-4aab-bc14-47e451af0d94'))
   .toBe('replies+crm-a8373f16-6062-4aab-bc14-47e451af0d94@receive.resend.app');
  expect(()=>normalizeEmail('Not Found')).toThrow();
  expect(()=>taggedReplyTo(null,'a8373f16-6062-4aab-bc14-47e451af0d94')).toThrow();
 });
 it('escapes user text and includes required postal and opt-out information',()=>{
  const result=renderRecruitmentEmail({
   body:'Hello <script> please confirm',
   postalAddress:'PO Box 1, Lee\'s Summit, MO',
   unsubscribeUrl:'https://example.org/unsubscribe?token=abc',
  });
  expect(result.html).not.toContain('<script>');
  expect(result.html).toContain('&lt;script&gt;');
  expect(result.text).toContain('Stop recruitment emails:');
  expect(result.text).toContain('PO Box 1');
  expect(()=>renderRecruitmentEmail({body:'test',postalAddress:'',
   unsubscribeUrl:'https://example.org'})).toThrow();
 });
});
