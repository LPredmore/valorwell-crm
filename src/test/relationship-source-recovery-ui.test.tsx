import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RelationshipReconciliationPage from '@/pages/crm/business-development/RelationshipReconciliationPage';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),mutate:true}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mocks.rpc}}));
vi.mock('@/hooks/crm/useCrmAuth',()=>({useCrmAuth:()=>({currentTenantId:'tenant',isAuthenticated:true,capabilities:{mutate:mocks.mutate},userId:'actor'})}));
vi.mock('@/repositories/supabase/relationship-tasks',()=>({relationshipTasksRepository:{create:vi.fn()}}));
vi.mock('@/lib/crm/relationship-orchestration',()=>({getRelationshipIntegrity:async()=>({flags:{}}),previewBtyReconciliation:vi.fn(),applyBtyReconciliation:vi.fn()}));
function show(){render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><RelationshipReconciliationPage/></MemoryRouter></QueryClientProvider>);}
afterEach(cleanup);
beforeEach(()=>{
 mocks.mutate=true;mocks.rpc.mockReset();
 mocks.rpc.mockImplementation(async(name:string,args?:{p_apply?:boolean})=>({error:null,data:
  name==='list_relationship_email_review_queue'?{summary:{openIssues:65},groups:[]}:
  name==='process_relationship_email_review_task_cleanup'?(args?.p_apply?{completed:23}:{eligible:23,blocked:33,tasks:[{taskId:'task',title:'Review BTY email associations · Synthetic'}]}):
  name==='get_relationship_email_source_recovery'?[{issueId:'issue',claimedMessageId:'original',threadId:'thread',exactIdentityVerified:false,safelyRepairable:false,sourceStatus:'NOT_FOUND',reason:'No exact source evidence',humanReviewRequired:false,providerRetrievalRequired:true,evidence:{}}]:
  name==='get_relationship_gmail_diagnostics'?[{connectionId:'connection',lastSuccessfulSyncAt:null,lastPushAt:null,secondsSinceSuccessfulSync:null}]:null}));
});
describe('reconciliation preview and evidence UI',()=>{
 it('previews tasks and calls only the authenticated completion RPC on click',async()=>{
  show();const button=await screen.findByRole('button',{name:'Complete 23 finished review tasks'});
  expect(screen.getByText('Review BTY email associations · Synthetic')).toBeInTheDocument();
  expect(mocks.rpc.mock.calls.some(([n,a])=>n==='process_relationship_email_review_task_cleanup'&&a?.p_apply)).toBe(false);
  fireEvent.click(button);
  await screen.findByText('23 finished review tasks completed. Source-blocked tasks remain open.');
  expect(mocks.rpc).toHaveBeenCalledWith('process_relationship_email_review_task_cleanup',{p_apply:true,p_limit:100});
 });
 it('shows unknown diagnostics and unverified originals without a repair button',async()=>{
  show();await screen.findByText('original · NOT FOUND');
  expect(screen.getByText(/Time since successful sync: Unknown/)).toBeInTheDocument();
  expect(screen.getByText(/0 exact identities verified/)).toBeInTheDocument();
 });
 it('does not offer administrative completion without mutation capability',async()=>{
  mocks.mutate=false;show();await screen.findByText('original · NOT FOUND');
  expect(screen.queryByRole('button',{name:/Complete 23/})).not.toBeInTheDocument();
  expect(mocks.rpc.mock.calls.some(([name])=>name==='process_relationship_email_review_task_cleanup')).toBe(false);
 });
});
