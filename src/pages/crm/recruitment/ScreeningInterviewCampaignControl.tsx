import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {Button} from '@/components/ui/button';
import {Card,CardContent,CardHeader,CardTitle} from '@/components/ui/card';
import {useCrmAuth} from '@/hooks/crm/useCrmAuth';
import {supabase} from '@/integrations/supabase/client';

type CampaignState={name:string;enabled:boolean;timezone:string;windowStart:string;
 windowEnd:string;initialHoursAfterSubmission:number;firstFollowupBusinessDays:number;
 secondFollowupDays:number;finalFollowupDays:number;finalStatus:string};

export function ScreeningInterviewCampaignControl({tenantId}:{tenantId:string}){
 const {crmRole,isAuthenticated}=useCrmAuth(),client=useQueryClient();
 const key=['crm-screening-interview-campaign',tenantId];
 const state=useQuery({queryKey:key,enabled:isAuthenticated&&!!tenantId,retry:false,
  queryFn:async():Promise<CampaignState>=>{
   const {data,error}=await supabase.rpc('crm_screening_interview_campaign_status' as never,
     {p_tenant_id:tenantId} as never);
   if(error)throw Error(error.message);
   if(!data||typeof (data as CampaignState).enabled!=='boolean')
    throw Error('Campaign status is unavailable.');
   return data as CampaignState;
  }});
 const change=useMutation({
  mutationFn:async(enabled:boolean)=>{
   const {data,error}=await supabase.rpc('crm_set_screening_interview_campaign_enabled' as never,
     {p_tenant_id:tenantId,p_enabled:enabled} as never);
   if(error)throw Error(error.message);
   if(!data||(data as {enabled?:boolean}).enabled!==enabled)throw Error('Could not verify campaign state.');
  },onSuccess:()=>client.invalidateQueries({queryKey:key})
 });
 const enabled=state.data?.enabled===true;
 const toggle=()=>{
  if(!window.confirm(enabled
   ?'Pause Screening interview invitations and reminders? Queued jobs will be preserved, but nothing will be sent until you explicitly reactivate this campaign.'
   :'Activate interview invitations for FUTURE qualifying, submitted website applications and manually approved Screening applicants? This activates the dedicated worker. Existing applicants will not be backfilled; other campaigns stay disabled.'))return;
  change.mutate(!enabled);
 };
 return <Card>
   <CardHeader><CardTitle>Qualified applications — Interview Invitation</CardTitle></CardHeader>
   <CardContent className="space-y-3 text-sm">
    {state.isPending&&<p role="status">Checking campaign status…</p>}
    {state.isError&&<p role="alert">{state.error.message}</p>}
    {state.data&&<>
     <p><strong>Status:</strong> {enabled?'Active':'Paused — no messages will send'}</p>
     <p>After a professional website application is submitted, automatically check the applicant's self-reported NPI, at least one state license number, and all applicable professional disclosures.
      Applicants passing every check move to <strong>Interview Invited</strong> and receive an interview invitation no sooner than two hours after submission.
      Applicants missing a criterion or reporting a disclosure flag move to <strong>Screening</strong> for manual review and do not receive an interview invitation.
      A manually cleared Screening applicant can then be moved to Interview Invited. Emails send only between 6 a.m. and 6 p.m. Central Time.</p>
     <p>After the initial invitation, reminders go out after 2 business days,
      then 7 days, then 7 days. After the final delivered reminder, move an unresponsive
      applicant to <strong>No Response</strong>. Booking an interview stops reminders.</p>
     <p>This campaign is separate from the paused New/Contacted campaign and from
      the retired legacy interview campaign. Existing applicant records are not enrolled retroactively.</p>
     {crmRole==='crm_admin'
      ?<Button variant={enabled?'outline':'default'} disabled={change.isPending}
       onClick={toggle}>{change.isPending?'Saving…':enabled?'Pause campaign':'Activate campaign'}</Button>
      :<p>Only a CRM administrator may change activation.</p>}
     {change.isError&&<p role="alert">{change.error.message}</p>}
    </>}
   </CardContent>
 </Card>;
}
