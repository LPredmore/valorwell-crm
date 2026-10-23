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
      const { data, error } = await supabase.rpc('crm_therapist_application_campaign_status' as never, {
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
      const { data, error } = await supabase.rpc('crm_set_therapist_application_campaign_enabled' as never, {
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
      'Activate therapist application follow-ups for FUTURE website interest submissions? New interests receive an immediate application link, transition to Contacted upon successful sending, and receive follow-ups after 2 business days, 7 days and 7 days, during 6 AM–6 PM Central Time. No historical applicants will be enrolled; the interview campaign stays paused.'
    )) return;
    if (!value && !window.confirm('Pause therapist application follow-ups? Initial interest receipt emails will still send immediately, but no scheduled reminders will be dispatched.')) return;
    toggle.mutate(value);
  };

  return (
    <Card>
      <CardHeader><CardTitle>Therapist Application — new interest follow-ups</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        {state.isPending && <p role="status">Checking campaign activation…</p>}
        {state.isError && <p role="alert">Campaign status unavailable: {state.error.message}</p>}
        {state.data && <>
          <p><strong>Activation:</strong> {enabled ? 'Active — new interest submissions start in New; after the immediate email sends, Contacted starts the follow-ups' : 'Paused — only immediate confirmation emails continue'}</p>
          <p>First invitation: immediately after new interest registration, with a link to /therapistapplication. Follow-up 1: two business days after New → Contacted, paired with RingCentral SMS when the applicant opts in. Follow-up 2: a soft reminder seven days after the first successful reminder. Follow-up 3: the final reminder seven days after that. After final successful sending, still-unresponsive applicants move to No Response. Follow-ups send between 6:00 AM and 6:00 PM Central Time (CST/CDT).</p>
          <p>Reminders stop as soon as a clinician verifies their email and begins the application. SMS requires a mobile number and separate optional SMS consent. Only new, consented /clinicians interest registrations are enrolled; older applicants and Indeed applicants are excluded. The old Interview campaign remains paused.</p>
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
