import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useCrmAuth } from '@/hooks/crm/useCrmAuth';
import { supabase } from '@/integrations/supabase/client';

type Control = {
  name: string;
  enabled: boolean;
  initialDelayHours: number;
  windowStart: string;
  windowEnd: string;
  timezone: string;
  steps: number;
};

export function RecruitmentInterviewCampaignControl({ tenantId }: { tenantId: string }) {
  const { crmRole, isAuthenticated } = useCrmAuth();
  const qc = useQueryClient();
  const queryKey = ['crm-applicant-interview-campaign-control', tenantId];
  const state = useQuery({
    queryKey,
    enabled: isAuthenticated && Boolean(tenantId),
    queryFn: async (): Promise<Control> => {
      const { data, error } = await supabase.rpc('crm_applicant_interview_campaign_status' as never, {
        p_tenant_id: tenantId,
      } as never);
      if (error) throw new Error(error.message);
      if (!data || typeof (data as Control).enabled !== 'boolean') {
        throw new Error('Campaign control is not configured.');
      }
      return data as Control;
    },
    retry: false,
  });
  const toggle = useMutation({
    mutationFn: async (enabled: boolean) => {
      const { data, error } = await supabase.rpc('crm_set_applicant_interview_campaign_enabled' as never, {
        p_tenant_id: tenantId,
        p_enabled: enabled,
      } as never);
      if (error) throw new Error(error.message);
      if (!data || (data as { enabled?: boolean }).enabled !== enabled) {
        throw new Error('Campaign activation result could not be verified.');
      }
    },
    onSuccess: async () => { await qc.invalidateQueries({ queryKey }); },
  });

  const enabled = state.data?.enabled === true;
  const canControl = crmRole === 'crm_admin';
  const update = (value: boolean) => {
    if (value && !window.confirm(
      'Activate Invitation to Interview for NEW clinician applicants? This authorizes three recruiting emails, beginning no sooner than two hours after each application and only from 6 AM to 6 PM Central Time. Existing applicants will not be backfilled.'
    )) return;
    if (!value && !window.confirm('Pause Invitation to Interview? Pending campaign emails will not be sent while it is paused.')) return;
    toggle.mutate(value);
  };

  return (
    <Card>
      <CardHeader><CardTitle>Invitation to Interview — clinician applicant campaign</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        {state.isPending && <p role="status">Checking campaign activation…</p>}
        {state.isError && <p role="alert">Campaign status unavailable: {state.error.message}</p>}
        {state.data && <>
          <p><strong>Activation:</strong> {enabled ? 'Active — new eligible applications start the sequence' : 'Paused — no new interview campaign emails'}</p>
          <p>First invitation: no sooner than 2 hours after applying. Email window: 6:00 AM to 6:00 PM Central Time (CST/CDT). Follow-ups: 2 days and 7 days after the preceding successful email, also within the window.</p>
          <p>Existing staff matches create a manual task instead. Confirmed bookings stop follow-ups and move the applicant to Interview Scheduled. No existing applicants are automatically backfilled.</p>
          {canControl && <Button variant={enabled ? 'outline' : 'default'} disabled={toggle.isPending} onClick={() => update(!enabled)}>
            {toggle.isPending ? 'Saving…' : enabled ? 'Pause campaign' : 'Activate campaign'}
          </Button>}
          {!canControl && <p>Only a CRM administrator may change campaign activation.</p>}
          {toggle.isError && <p role="alert">Could not save campaign activation: {toggle.error.message}</p>}
        </>}
      </CardContent>
    </Card>
  );
}
