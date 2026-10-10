import {useEffect,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {Card,CardContent,CardDescription,CardHeader,CardTitle} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {listRecruitmentDrafts} from '@/repositories/supabase/recruitment-campaign-prep';
import {
 getRecruitmentContactPermission,getRecruitmentDeliveryGate,recordRecruitmentContactPermission,
 recruitmentGateReasonLabels,stageRecruitmentHeldPlan,
 type RecruitmentPermissionStatus,
} from '@/repositories/supabase/recruitment-delivery';

export function RecruitmentDeliverySafetyPanel({tenantId,prospectId,canEdit}:{
 tenantId:string;prospectId:string;canEdit:boolean;
}){
 const qc=useQueryClient();
 const [seq,setSeq]=useState('');
 const [permission,setPermission]=useState<RecruitmentPermissionStatus>('unknown');
 const [source,setSource]=useState('');
 const [evidence,setEvidence]=useState('');
 const [lastPlan,setLastPlan]=useState('');
 const drafts=useQuery({
  queryKey:['recruitment-draft-sequences',tenantId],
  queryFn:()=>listRecruitmentDrafts(tenantId),
 });
 const recorded=useQuery({
  queryKey:['recruitment-contact-permission',tenantId,prospectId],
  queryFn:()=>getRecruitmentContactPermission(tenantId,prospectId),
 });
 const gate=useQuery({
  queryKey:['recruitment-delivery-gate',tenantId,seq,prospectId],
  queryFn:()=>getRecruitmentDeliveryGate(tenantId,seq,prospectId),
  enabled:!!seq,retry:false,
 });
 useEffect(()=>{
  if(!recorded.data)return;
  setPermission(recorded.data.emailPermission);
  setSource(recorded.data.evidenceSource??'');
  setEvidence(recorded.data.evidenceDetails??'');
 },[recorded.data]);
 const save=useMutation({
  mutationFn:()=>recordRecruitmentContactPermission({
   tenantId,prospectId,status:permission,evidenceSource:source.trim(),
   evidenceDetails:evidence.trim(),
  }),
  onSuccess:async()=>{
   await Promise.all([
    qc.invalidateQueries({queryKey:['recruitment-contact-permission',tenantId,prospectId]}),
    qc.invalidateQueries({queryKey:['recruitment-delivery-gate',tenantId]}),
    qc.invalidateQueries({queryKey:['recruitment-sequence-preview',tenantId]}),
   ]);
  },
 });
 const hold=useMutation({
  mutationFn:()=>stageRecruitmentHeldPlan(tenantId,seq,prospectId),
  onSuccess:async result=>{
   setLastPlan(result.planId);
   await Promise.all([
    qc.invalidateQueries({queryKey:['recruitment-delivery-gate',tenantId]}),
    qc.invalidateQueries({queryKey:['recruitment-delivery-ledger',tenantId]}),
   ]);
  },
 });
 const evidenceValid=source.trim().length>=5&&evidence.trim().length>=12;
 return <Card><CardHeader><CardTitle>Recruitment delivery safeguards</CardTitle>
  <CardDescription>Verification, documented outreach authorization and suppressions are checked separately.
   No sequence can be activated or sent from here; any delivery plan is held.</CardDescription>
 </CardHeader><CardContent className="space-y-4 text-sm">
  {recorded.isLoading&&<p>Loading contact permission history…</p>}
  {recorded.isError&&<p role="alert" className="text-destructive">{recorded.error.message}</p>}
  {recorded.data&&<p><strong>Documented outreach permission:</strong> {recorded.data.emailPermission}
    {recorded.data.reviewedAt?' · Last reviewed '+new Date(recorded.data.reviewedAt).toLocaleString():''}</p>}
  {canEdit&&<div className="space-y-3 rounded-md border p-3">
   <p className="text-xs text-muted-foreground">Only mark Approved if you have authentic, documented authority to contact this person.
    A valid email or public professional profile is not, by itself, permission.
    Saving approval never starts delivery.</p>
   <div className="space-y-1"><Label htmlFor="recruitment-email-permission">Email outreach permission</Label>
    <select id="recruitment-email-permission" className="h-10 w-full rounded border bg-background px-3"
     value={permission} onChange={e=>setPermission(e.target.value as RecruitmentPermissionStatus)}>
     <option value="unknown">Unknown / not documented</option>
     <option value="approved">Approved — evidence required</option>
     <option value="revoked">Revoked / no contact</option>
    </select></div>
   <div className="space-y-1"><Label htmlFor="recruitment-permission-source">Evidence source</Label>
    <Input id="recruitment-permission-source" value={source} maxLength={100}
     onChange={e=>setSource(e.target.value)} placeholder="How permission was obtained"/></div>
   <div className="space-y-1"><Label htmlFor="recruitment-permission-evidence">Evidence and context</Label>
    <Input id="recruitment-permission-evidence" value={evidence} maxLength={1200}
     onChange={e=>setEvidence(e.target.value)} placeholder="Specific documented evidence (not merely a website listing)"/></div>
   <Button variant="outline" disabled={save.isPending||(permission==='approved'&&!evidenceValid)}
    onClick={()=>save.mutate()}>{save.isPending?'Recording…':'Record permission review (no sending)'}</Button>
   {save.isError&&<p role="alert" className="text-destructive">{save.error.message}</p>}
   {save.isSuccess&&<p role="status">Permission review recorded. Outbound sending remains disabled.</p>}
  </div>}
  <div className="space-y-2">
   <Label htmlFor="recruitment-sequence-gate">Check against a recruitment sequence</Label>
   <select id="recruitment-sequence-gate" className="h-10 w-full rounded border bg-background px-3"
    value={seq} onChange={e=>{setSeq(e.target.value);setLastPlan('');}}>
    <option value="">Select a saved draft sequence</option>
    {(drafts.data??[]).map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
   </select>
   {drafts.isError&&<p role="alert" className="text-destructive">{drafts.error.message}</p>}
   {gate.isLoading&&<p>Checking source identity, outreach permission, suppressions and prior contact…</p>}
   {gate.isError&&<p role="alert" className="text-destructive">{gate.error.message}</p>}
   {gate.data&&<>
    <p><strong>Held-plan eligibility:</strong> {gate.data.canCreateHeldPlan?'All required prerequisites documented':'Blocked — review items below'}</p>
    {gate.data.reasons.length>0&&<ul className="list-disc pl-5 space-y-1">
     {gate.data.reasons.map(reason=><li key={reason}>{recruitmentGateReasonLabels[reason]??reason}</li>)}
    </ul>}
    <p className="font-medium">Provider delivery: disabled, even when the held-plan check passes.</p>
    {canEdit&&<Button variant="outline" disabled={!gate.data.canCreateHeldPlan||hold.isPending}
     onClick={()=>hold.mutate()}>{hold.isPending?'Staging…':'Create held delivery plan (no sending)'}</Button>}
   </>}
   {hold.isError&&<p role="alert" className="text-destructive">{hold.error.message}</p>}
   {lastPlan&&<p role="status">Held plan created: {lastPlan}. No email sent, scheduled with a worker, or enrolled.</p>}
  </div>
 </CardContent></Card>;
}
