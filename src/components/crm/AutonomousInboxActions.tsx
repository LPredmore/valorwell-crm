import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';

type InboxAction = {
  id: string;
  type: string;
  riskTier: string;
  status: 'proposed'|'awaiting_approval'|'approved'|'rejected'|'cancelled'|'succeeded'|'failed';
  summary: string;
  createdAt: string;
  approvedAt: string | null;
  verifiedReceipt: { recordedAt: string; outcome: string; sourceTaskId: string } | null;
};
const actionsRpc = supabase as unknown as {
  rpc: (name: string, args: Record<string,unknown>) =>
    Promise<{ data: unknown; error: {message:string}|null }>;
};
async function getActions(caseId:string):Promise<InboxAction[]>{
  const {data,error}=await actionsRpc.rpc('crm_autonomous_inbox_actions_v1',{p_case_id:caseId});
  if(error)throw new Error(error.message);
  if(!Array.isArray(data))throw new Error('Invalid action queue response');
  return data as InboxAction[];
}
async function decide(id:string,decision:'approve'|'reject'){
  const {error}=await actionsRpc.rpc('crm_autonomous_inbox_decide_action_v1',{
    p_action_id:id,p_decision:decision,p_note:null,
  });
  if(error)throw new Error(error.message);
}
async function verify(id:string){
  const {error}=await actionsRpc.rpc('crm_autonomous_inbox_verify_followup_v1',{p_action_id:id});
  if(error)throw new Error(error.message);
}

/** Internal-task verification only; not a messaging or general-purpose action executor. */
export function AutonomousInboxActions({caseId,canEdit}: {caseId:string;canEdit:boolean}){
  const [expanded,setExpanded]=useState(false);
  const client=useQueryClient();
  const key=['crm-autonomous-inbox-actions',caseId];
  const q=useQuery({queryKey:key,queryFn:()=>getActions(caseId),enabled:expanded,retry:false});
  const mutation=useMutation({
    mutationFn:async ({id,operation}:{id:string;operation:'approve'|'reject'|'verify'})=>{
      if(operation==='verify')return verify(id);
      return decide(id,operation);
    },
    onSuccess:async ()=>{
      await Promise.all([
        client.invalidateQueries({queryKey:key}),
        client.invalidateQueries({queryKey:['crm-autonomous-inbox']}),
      ]);
    },
  });
  return <div className="space-y-2 rounded-md bg-muted/30 p-3">
    <Button variant="outline" size="sm" aria-expanded={expanded}
      onClick={()=>setExpanded(current=>!current)}>
      {expanded?'Hide':'Show'} proposed actions
    </Button>
    {expanded && <>
      <p className="text-xs text-muted-foreground">
        Only existing internal CRM follow-up tasks can be verified. Approval does not send messages,
        change recipients, or close cases.
      </p>
      {q.isLoading && <p className="text-sm text-muted-foreground">Loading action history…</p>}
      {q.isError && <p role="alert" className="text-sm text-destructive">
        {q.error instanceof Error?q.error.message:'Unable to load action history.'}
      </p>}
      {mutation.isError && <p role="alert" className="text-sm text-destructive">
        {mutation.error instanceof Error?mutation.error.message:'Unable to update the action.'}
      </p>}
      {q.data?.length===0 && <p className="text-sm text-muted-foreground">No action proposals.</p>}
      {q.data?.map(action=><div key={action.id} className="space-y-2 rounded border bg-background p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{action.status.replace(/_/g,' ')}</Badge>
          <span className="text-xs text-muted-foreground">Risk: {action.riskTier}</span>
        </div>
        <p className="text-sm">{action.summary || 'Internal CRM task review'}</p>
        {action.verifiedReceipt && <p className="text-xs text-muted-foreground">
          Verified against the existing CRM task on {new Date(action.verifiedReceipt.recordedAt).toLocaleString()}.
        </p>}
        {canEdit && ['proposed','awaiting_approval'].includes(action.status) &&
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={mutation.isPending}
              onClick={()=>mutation.mutate({id:action.id,operation:'approve'})}>
              Approve verification
            </Button>
            <Button size="sm" variant="outline" disabled={mutation.isPending}
              onClick={()=>mutation.mutate({id:action.id,operation:'reject'})}>
              Reject
            </Button>
          </div>}
        {canEdit && action.status==='approved' &&
          <Button size="sm" disabled={mutation.isPending}
            onClick={()=>mutation.mutate({id:action.id,operation:'verify'})}>
            Verify assigned CRM task
          </Button>}
      </div>)}
    </>}
  </div>;
}
