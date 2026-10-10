import {useQuery} from '@tanstack/react-query';
import {Card,CardContent,CardDescription,CardHeader,CardTitle} from '@/components/ui/card';
import {getRecruitmentDeliveryLedger,getRecruitmentSchedulePreview} from '@/repositories/supabase/recruitment-delivery';
export function RecruitmentDeliveryLedgerPanel({tenantId,sequenceId}:{tenantId:string;sequenceId:string}){
 const schedule=useQuery({
  queryKey:['recruitment-schedule-preview',tenantId,sequenceId],
  queryFn:()=>getRecruitmentSchedulePreview(tenantId,sequenceId),
 });
 const ledger=useQuery({
  queryKey:['recruitment-delivery-ledger',tenantId,sequenceId],
  queryFn:()=>getRecruitmentDeliveryLedger(tenantId,sequenceId),
 });
 return <Card><CardHeader>
  <CardTitle>Delivery planning and event reconciliation</CardTitle>
  <CardDescription>Step timing is illustrative until a qualified clinician is individually reviewed.
   All delivery plans remain on HOLD, and no worker can send them.</CardDescription>
 </CardHeader><CardContent className="space-y-3 text-sm">
  {schedule.isLoading&&<p>Loading step timing…</p>}
  {schedule.isError&&<p role="alert" className="text-destructive">{schedule.error.message}</p>}
  {schedule.data&&<div className="rounded border p-3 space-y-2">
   <strong>Step timing preview</strong>
   {schedule.data.schedule.map(s=><p key={s.stepNumber}>
    Step {s.stepNumber} · {s.daysAfterPrevious} day(s) after previous ·
    {' '}{new Date(s.plannedFor).toLocaleString()} · {s.subject}
   </p>)}
  </div>}
  {ledger.isLoading&&<p>Loading held delivery ledger…</p>}
  {ledger.isError&&<p role="alert" className="text-destructive">{ledger.error.message}</p>}
  {ledger.data&&<>
   <div className="flex flex-wrap gap-x-5 gap-y-1">
    <p><strong>{ledger.data.totalPlans}</strong> held/stopped plans</p>
    <p><strong>{ledger.data.heldSteps}</strong> held steps</p>
    <p><strong>{ledger.data.stoppedSteps}</strong> cancelled follow-ups</p>
    <p><strong>{ledger.data.deliveredSteps}</strong> delivered</p>
    <p><strong>{ledger.data.bouncedSteps}</strong> bounced</p>
    <p><strong>{ledger.data.complainedSteps}</strong> complaints</p>
   </div>
   <p className="font-medium">Sender/worker: disabled. No test or live messages will be dispatched from this page.</p>
   {ledger.data.items.length===0&&<p className="text-muted-foreground">No held delivery plans have been created. A validated source and documented contact permission are required before staging any plan.</p>}
   {ledger.data.items.slice(0,30).map(item=><p className="rounded border p-2" key={item.planId+':'+item.stepNumber}>
    {item.state.toUpperCase()} · Step {item.stepNumber} · {new Date(item.dueAt).toLocaleString()}
    {item.stoppedReason?' · '+item.stoppedReason:''}
    {item.providerMessageId?' · Provider record linked':''}
   </p>)}
  </>}
 </CardContent></Card>;
}
