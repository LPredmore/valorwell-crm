import {describe,it,expect} from 'vitest';
import {
 isSafeToStageHeldPlan,recruitmentGateReasonLabels,type RecruitmentGate,
} from '@/repositories/supabase/recruitment-delivery';

const approved:RecruitmentGate={
 sequenceId:'seq',prospectId:'prospect',email:'example@example.org',
 canCreateHeldPlan:true,canSend:false,sendingEnabled:false,reasons:[],
};

describe('recruitment held delivery safeguards',()=>{
 it('only stages explicitly approved plans while provider delivery remains disabled',()=>{
  expect(isSafeToStageHeldPlan(approved)).toBe(true);
  expect(isSafeToStageHeldPlan(null)).toBe(false);
  expect(isSafeToStageHeldPlan(undefined)).toBe(false);
  expect(isSafeToStageHeldPlan({...approved,canCreateHeldPlan:false})).toBe(false);
  expect(isSafeToStageHeldPlan({...approved,reasons:['suppressed_or_do_not_contact']})).toBe(false);
  expect(isSafeToStageHeldPlan({...approved,sendingEnabled:true} as unknown as RecruitmentGate)).toBe(false);
  expect(isSafeToStageHeldPlan({...approved,canSend:true} as unknown as RecruitmentGate)).toBe(false);
 });
 it('surfaces every high-risk eligibility blocker in plain language',()=>{
  for(const key of [
   'invalid_or_missing_email','duplicate_identity','email_identity_unverified',
   'contact_permission_not_approved','suppressed_or_do_not_contact',
   'reply_already_received','prior_outbound_contact','possible_existing_identity',
   'applicant_already_linked','recruitment_bounce_or_complaint',
  ])expect(recruitmentGateReasonLabels[key]?.length).toBeGreaterThan(12);
 });
});
