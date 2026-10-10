import {useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Card,CardContent,CardHeader,CardTitle,CardDescription} from '@/components/ui/card';
import {
 getApplicantCandidates,getRecruitmentPreview,linkExistingApplicant,reviewProspectEmail,
 type ReviewedProspect,
} from '@/repositories/supabase/recruitment-review';

export function RecruitmentPreviewPanel({tenantId}:{tenantId:string}){
 const {data,error,isLoading}=useQuery({
  queryKey:['recruitment-campaign-preview',tenantId],
  queryFn:()=>getRecruitmentPreview(tenantId),retry:false,
 });
 return <Card><CardHeader><CardTitle>Recruitment readiness · sending paused</CardTitle>
  <CardDescription>Dry-run only. These counts are for recruitment review, not permission to email or text.</CardDescription></CardHeader>
  <CardContent className="space-y-2">
   {isLoading&&<p>Calculating tenant-wide quality and eligibility…</p>}
   {error&&<p role="alert" className="text-destructive">{error.message}</p>}
   {data&&<>
    <div className="grid gap-2 text-sm grid-cols-2 md:grid-cols-4">
     <p><strong>{data.total}</strong> total prospects</p>
     <p><strong>{data.review}</strong> need review</p>
     <p><strong>{data.emailValid}</strong> valid unique emails</p>
     <p><strong>{data.emailMissing}</strong> missing email</p>
     <p><strong>{data.emailInvalid}</strong> invalid email</p>
     <p><strong>{data.emailDuplicate}</strong> duplicate valid email rows</p>
     <p><strong>{data.suppressed}</strong> excluded/suppressed</p>
     <p><strong>{data.possibleIdentityMatch}</strong> possible existing identity matches</p>
    </div>
    <p className="text-sm"><strong>{data.technicallyReady}</strong> technically reviewed for a future email preview. This does not establish marketing consent.</p>
    <p role="status" className="text-sm font-medium">Email and SMS campaign execution are disabled. No send or enrollment controls are provided here.</p>
   </>}
  </CardContent>
 </Card>;
}
export function RecruitmentQualificationPanel({tenantId,row,canEdit}:{
 tenantId:string;row:ReviewedProspect;canEdit:boolean;
}){
 const qc=useQueryClient();
 const [reviewStatus,setReviewStatus]=useState<'unverified'|'verified'|'invalid'>('verified');
 const [reason,setReason]=useState('');
 const [linkReason,setLinkReason]=useState('');
 const candidates=useQuery({
  queryKey:['recruitment-applicant-candidates',tenantId,row.id],
  queryFn:()=>getApplicantCandidates(tenantId,row.id),retry:false,
 });
 const emailReview=useMutation({
  mutationFn:()=>reviewProspectEmail(tenantId,row.id,row.version,reviewStatus,reason.trim()),
  onSuccess:async()=>{setReason('');await Promise.all([
   qc.invalidateQueries({queryKey:['therapist-prospect-review']}),
   qc.invalidateQueries({queryKey:['therapist-prospect-history']}),
   qc.invalidateQueries({queryKey:['recruitment-campaign-preview']}),
   qc.invalidateQueries({queryKey:['pipeline-connected-cards']}),
  ])},
 });
 const link=useMutation({
  mutationFn:(applicantId:string)=>linkExistingApplicant(tenantId,row.id,applicantId,linkReason.trim()),
  onSuccess:async()=>{setLinkReason('');await Promise.all([
   qc.invalidateQueries({queryKey:['recruitment-applicant-candidates']}),
   qc.invalidateQueries({queryKey:['therapist-prospect-history']}),
   qc.invalidateQueries({queryKey:['therapist-prospect-review']}),
   qc.invalidateQueries({queryKey:['recruitment-communication-timeline',tenantId,row.id]}),
   qc.invalidateQueries({queryKey:['pipeline-connected-cards']}),
  ])},
 });
 return <div className="space-y-4">
  <Card><CardHeader><CardTitle>Contact quality and identity review</CardTitle>
   <CardDescription>Manual evidence review. Verifying an address is not proof of consent and never sends a message.</CardDescription></CardHeader>
   <CardContent className="space-y-3 text-sm">
    <div className="grid gap-2 grid-cols-2">
     <p><strong>Email:</strong> {row.emailQuality}</p>
     <p><strong>Email review:</strong> {row.emailReviewStatus}</p>
     <p><strong>Phone format:</strong> {row.phoneValid?'Usable format':'Missing or invalid'}</p>
     <p><strong>Suppression:</strong> {row.suppressed?'Excluded — do not contact':'No detected source exclusion'}</p>
     <p><strong>Shared email:</strong> {row.duplicateEmailCount>1?row.duplicateEmailCount+' source records':'No source duplication detected'}</p>
     <p><strong>Possible existing identity:</strong> {row.possibleApplicant||row.possibleContact?'Review possible match':'No exact email or phone match'}</p>
    </div>
    {row.emailQuality!=='valid'&&<p role="status" className="text-destructive">This address cannot be cleared for recruitment email: {row.emailQuality}.</p>}
    {row.suppressed&&<p role="alert" className="text-destructive">Do not contact: source or shared CRM suppression exists.</p>}
    {canEdit&&<div className="space-y-2 border-t pt-3">
     <Label htmlFor="email-review-status">Document email verification</Label>
     <select id="email-review-status" className="h-10 w-full rounded border bg-background px-3" value={reviewStatus}
      onChange={e=>setReviewStatus(e.target.value as 'verified'|'invalid'|'unverified')}>
      <option value="verified" disabled={row.emailQuality!=='valid'||row.suppressed}>Verified manually</option>
      <option value="invalid">Mark invalid</option><option value="unverified">Reset verification</option>
     </select>
     <Label htmlFor="email-review-reason">Evidence / reason (required)</Label>
     <Input id="email-review-reason" placeholder="How was the email checked? No sending is performed." maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/>
     {emailReview.isError&&<p role="alert" className="text-destructive">{emailReview.error.message}</p>}
     <Button variant="outline" disabled={emailReview.isPending||reason.trim().length<8||(reviewStatus==='verified'&&(row.emailQuality!=='valid'||row.suppressed))}
      onClick={()=>emailReview.mutate()}>{emailReview.isPending?'Recording…':'Record verification in audit history'}</Button>
    </div>}
   </CardContent>
  </Card>
  <Card><CardHeader><CardTitle>Existing applicant reconciliation</CardTitle>
   <CardDescription>Exact email or phone matches are suggestions, not automatic identity merges. Existing applicants are never created or emailed by this action.</CardDescription></CardHeader>
   <CardContent className="space-y-3 text-sm">
    {candidates.isLoading&&<p>Checking the existing applicant directory…</p>}
    {candidates.isError&&<p role="alert" className="text-destructive">{candidates.error.message}</p>}
    {candidates.data?.linkedApplicantId&&<p role="status">Linked existing application: {candidates.data.linkedApplicantId}. <a className="text-primary underline" href="https://emr.valorwell.org/staff/provider-applicants">Open applicant workspace</a>. No invitation or email was sent by linking.</p>}
    {candidates.data?.matches.length===0&&<p>No matching applicant found. Do not create a duplicate applicant without reviewing the original application process.</p>}
    {(candidates.data?.matches??[]).map(a=><div key={a.id} className="rounded border p-3 space-y-2">
     <p><strong>{a.name}</strong> · {a.status} · {a.reason}</p>
     {canEdit&&!candidates.data?.linkedApplicantId&&<>
      <Label htmlFor={'link-reason-'+a.id}>Reason and evidence for linking</Label>
      <Input id={'link-reason-'+a.id} value={linkReason} maxLength={500} onChange={e=>setLinkReason(e.target.value)}/>
      <Button variant="outline" disabled={link.isPending||linkReason.trim().length<8}
       onClick={()=>link.mutate(a.id)}>Link this existing applicant</Button>
     </>}
    </div>)}
    {link.isError&&<p role="alert" className="text-destructive">{link.error.message}</p>}
   </CardContent>
  </Card>
 </div>;
}
