import {useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {Button} from '@/components/ui/button';
import {Card,CardContent,CardDescription,CardHeader,CardTitle} from '@/components/ui/card';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {
 getRecruitmentEnrichment,proposeRecruitmentEmail,reviewRecruitmentEmail,
} from '@/repositories/supabase/recruitment-enrichment';

export function RecruitmentEnrichmentPanel({tenantId,prospectId,canEdit}:{
 tenantId:string;prospectId:string;canEdit:boolean;
}){
 const qc=useQueryClient();
 const [email,setEmail]=useState('');const [sourceUrl,setSourceUrl]=useState('');
 const [evidence,setEvidence]=useState('');
 const [reviewNotes,setReviewNotes]=useState('');
 const list=useQuery({queryKey:['recruitment-email-enrichment',tenantId,prospectId],
  queryFn:()=>getRecruitmentEnrichment(tenantId,prospectId),retry:false});
 const invalidate=async()=>{
  await Promise.all([
   qc.invalidateQueries({queryKey:['recruitment-email-enrichment',tenantId,prospectId]}),
   qc.invalidateQueries({queryKey:['therapist-prospect-review']}),
   qc.invalidateQueries({queryKey:['recruitment-contact-permission',tenantId,prospectId]}),
   qc.invalidateQueries({queryKey:['recruitment-delivery-gate',tenantId]}),
   qc.invalidateQueries({queryKey:['recruitment-campaign-preview']}),
   qc.invalidateQueries({queryKey:['pipeline-connected-cards']}),
  ]);
 };
 const propose=useMutation({
  mutationFn:()=>proposeRecruitmentEmail({tenantId,prospectId,email,sourceUrl,notes:evidence}),
  onSuccess:async()=>{setEmail('');setSourceUrl('');setEvidence('');await invalidate()},
 });
 const review=useMutation({
  mutationFn:({id,decision}:{id:string;decision:'approved'|'rejected'})=>
   reviewRecruitmentEmail({tenantId,proposalId:id,decision,notes:reviewNotes}),
  onSuccess:async()=>{setReviewNotes('');await invalidate()},
 });
 const emailValid=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
 const pending=list.data?.find(p=>p.status==='pending');
 return <Card><CardHeader>
  <CardTitle>Therapist contact enrichment</CardTitle>
  <CardDescription>Propose an email from a documented professional source; review it before updating the prospect.
   An accepted email is still unverified and is never authorization to send recruitment messages.</CardDescription>
 </CardHeader><CardContent className="space-y-4 text-sm">
  {list.isLoading&&<p>Loading email research history…</p>}
  {list.isError&&<p role="alert" className="text-destructive">{list.error.message}</p>}
  {(list.data??[]).map(entry=><div key={entry.id} className="rounded border p-3 space-y-2">
   <div className="flex flex-wrap items-center justify-between gap-2">
    <strong>{entry.email}</strong><span>{entry.status.toUpperCase()}</span>
   </div>
   <p className="break-words text-muted-foreground">{entry.notes}</p>
   <a className="text-primary underline break-all" href={entry.sourceUrl}
    target="_blank" rel="noopener noreferrer">Review documented professional source</a>
   {entry.reviewNotes&&<p>Review: {entry.reviewNotes}</p>}
   {entry.status==='pending'&&canEdit&&<div className="space-y-2">
    <Label htmlFor={'email-review-'+entry.id}>Decision evidence / reason</Label>
    <Input id={'email-review-'+entry.id} value={reviewNotes} maxLength={1200}
     onChange={e=>setReviewNotes(e.target.value)}
     placeholder="Why this address does or does not belong to this therapist"/>
    <div className="flex flex-wrap gap-2">
     <Button size="sm" variant="outline" disabled={review.isPending||reviewNotes.trim().length<10}
      onClick={()=>review.mutate({id:entry.id,decision:'approved'})}>Accept address (still unverified)</Button>
     <Button size="sm" variant="outline" disabled={review.isPending||reviewNotes.trim().length<10}
      onClick={()=>review.mutate({id:entry.id,decision:'rejected'})}>Reject suggestion</Button>
    </div>
   </div>}
  </div>)}
  {review.isError&&<p role="alert" className="text-destructive">{review.error.message}</p>}
  {review.isSuccess&&<p role="status">Proposal reviewed. No outreach or email verification was approved.</p>}
  {!pending&&canEdit&&<div className="space-y-3 rounded border p-3">
   <strong>Propose a new professional email</strong>
   <div className="space-y-1">
    <Label htmlFor="enrichment-email">Suggested address</Label>
    <Input id="enrichment-email" inputMode="email" value={email} maxLength={254}
     onChange={e=>setEmail(e.target.value)} placeholder="therapist@example.org"/>
   </div>
   <div className="space-y-1">
    <Label htmlFor="enrichment-source">Public professional source (HTTPS URL)</Label>
    <Input id="enrichment-source" value={sourceUrl} maxLength={1000}
     onChange={e=>setSourceUrl(e.target.value)} placeholder="https://provider-directory.example/profile"/>
   </div>
   <div className="space-y-1">
    <Label htmlFor="enrichment-evidence">Why this belongs to the specific therapist</Label>
    <Input id="enrichment-evidence" value={evidence} maxLength={1200}
     onChange={e=>setEvidence(e.target.value)}
     placeholder="Match the name, practice, license and professional profile"/>
   </div>
   <Button variant="outline" disabled={propose.isPending||!emailValid||
    !sourceUrl.trim().startsWith('https://')||evidence.trim().length<12}
    onClick={()=>propose.mutate()}>
    {propose.isPending?'Submitting…':'Submit for review (no sending)'}
   </Button>
   {propose.isError&&<p role="alert" className="text-destructive">{propose.error.message}</p>}
   {propose.isSuccess&&<p role="status">Suggestion saved for review; source email unchanged.</p>}
  </div>}
  {pending&&<p className="text-muted-foreground">One proposal is awaiting review. Review it before suggesting another email.</p>}
 </CardContent></Card>;
}
