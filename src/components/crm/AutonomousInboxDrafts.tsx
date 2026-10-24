import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';

type Revision = { revision:number;createdAt:string;createdBy:string };
type DraftState = {
 caseId:string;caseState:string;latestRevision:number;
 body:string;savedAt:string|null;history:Revision[];deliveryState:'not_sent';
};
const rpc=supabase as unknown as {
 rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:{message:string}|null}>;
};
async function read(caseId:string):Promise<DraftState>{
 const {data,error}=await rpc.rpc('crm_autonomous_inbox_drafts_v1',{p_case_id:caseId});
 if(error)throw new Error(error.message);
 if(!data||typeof data!=='object'||typeof (data as DraftState).latestRevision!=='number'){
  throw new Error('Invalid CRM draft response');
 }
 return data as DraftState;
}
async function save(caseId:string,body:string,expectedRevision:number){
 const {data,error}=await rpc.rpc('crm_autonomous_inbox_save_draft_v1',{
  p_case_id:caseId,p_body:body,p_expected_revision:expectedRevision,
 });
 if(error)throw new Error(error.message);
 return data;
}

/** Drafts are not messages and cannot be sent from this component. */
export function AutonomousInboxDrafts({caseId,canEdit}:{caseId:string;canEdit:boolean}){
 const [expanded,setExpanded]=useState(false);
 const [text,setText]=useState('');
 const client=useQueryClient();
 const queryKey=['crm-autonomous-drafts',caseId];
 const draft=useQuery({queryKey,queryFn:()=>read(caseId),enabled:expanded,retry:false});
 useEffect(()=>{
  if(draft.data)setText(draft.data.body??'');
 },[draft.data?.latestRevision, draft.data?.body]);
 const saveDraft=useMutation({
  mutationFn:async()=>save(caseId,text,draft.data?.latestRevision??0),
  onSuccess:async()=>{
   await Promise.all([
    client.invalidateQueries({queryKey}),
    client.invalidateQueries({queryKey:['crm-autonomous-inbox']}),
   ]);
  },
 });
 const changed=Boolean(draft.data && text!==draft.data.body);
 return <div className="space-y-3 rounded-md bg-muted/30 p-3">
  <Button size="sm" variant="outline" aria-expanded={expanded}
    onClick={()=>setExpanded(open=>!open)}>
    {expanded?'Hide':'Open'} internal reply draft
  </Button>
  {expanded&&<>
   <p className="text-xs text-muted-foreground">
    Manually prepare a reply inside the secured CRM. Saving makes a new immutable revision.
    It does not send a message, select a recipient, or submit text to an AI provider.
   </p>
   {draft.isLoading&&<p className="text-sm text-muted-foreground">Loading saved draft…</p>}
   {draft.isError&&<p role="alert" className="text-sm text-destructive">
    {draft.error instanceof Error?draft.error.message:'Unable to read draft.'}
   </p>}
   {saveDraft.isError&&<p role="alert" className="text-sm text-destructive">
    {saveDraft.error instanceof Error?saveDraft.error.message:'Unable to save draft.'}
   </p>}
   {draft.data&&<>
    <Textarea value={text} onChange={event=>setText(event.target.value)}
      rows={6} maxLength={12000} disabled={!canEdit||saveDraft.isPending}
      aria-label="Unsent reply draft" placeholder="Write a draft to be reviewed later. Nothing is sent." />
    <div className="flex flex-wrap items-center justify-between gap-2">
     <p className="text-xs text-muted-foreground">
      Revision {draft.data.latestRevision} · {text.length}/12,000 characters · Never sent
     </p>
     {canEdit&&<Button size="sm" disabled={!changed||!text.trim()||saveDraft.isPending}
       onClick={()=>saveDraft.mutate()}>{saveDraft.isPending?'Saving…':'Save new revision'}</Button>}
    </div>
    {saveDraft.isSuccess&&<p role="status" className="text-xs text-muted-foreground">
     Saved inside CRM only. No email or SMS was sent.
    </p>}
    {draft.data.history.length>0&&<p className="text-xs text-muted-foreground">
     Saved revision history: {draft.data.history.map(x=>x.revision).join(', ')}.
    </p>}
   </>}
  </>}
 </div>;
}
