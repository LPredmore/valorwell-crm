import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Activity, AlertCircle, CalendarCheck, Clock, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';

type EventType =
  | 'page_opened' | 'invitation_verified' | 'invitation_rejected'
  | 'availability_viewed' | 'slot_selected' | 'booking_submitted'
  | 'booking_confirmed' | 'booking_failed' | 'booking_client_error'
  | 'booking_crm_sync_warning';

interface FunnelEvent {
  id: string;
  created_at: string;
  visitor_session_id: string;
  booking_attempt_id: string | null;
  organization_id: string | null;
  opportunity_id: string | null;
  event_type: EventType;
  meeting_type: 'pre_interview' | 'bty_interview' | null;
  requested_start_utc: string | null;
  failure_code: string | null;
  failure_stage: string | null;
  http_status: number | null;
}

const labels: Record<EventType, string> = {
  page_opened: 'Scheduler opened',
  invitation_verified: 'Invitation verified',
  invitation_rejected: 'Invitation not matched',
  availability_viewed: 'Available times viewed',
  slot_selected: 'Time selected',
  booking_submitted: 'Booking submitted',
  booking_confirmed: 'Calendar booking confirmed',
  booking_failed: 'Booking rejected',
  booking_client_error: 'Browser reported an error',
  booking_crm_sync_warning: 'CRM synchronization warning',
};

interface VisitorSession {
  id: string;
  events: FunnelEvent[];
  organizationId: string | null;
  opportunityId: string | null;
  selectedTime: string | null;
  latest: string;
  state: string;
  needsAttention: boolean;
}

function summarize(events: FunnelEvent[]): VisitorSession[] {
  const groups = new Map<string, FunnelEvent[]>();
  for (const event of events) {
    groups.set(event.visitor_session_id, [...(groups.get(event.visitor_session_id) ?? []), event]);
  }
  return Array.from(groups, ([id, unordered]) => {
    const ordered = unordered.sort((a, b) => a.created_at.localeCompare(b.created_at));
    const types = new Set(ordered.map((event) => event.event_type));
    const lastMatched = [...ordered].reverse().find((event) => event.organization_id);
    const selected = [...ordered].reverse().find((event) => event.requested_start_utc);
    const hasConfirmed = types.has('booking_confirmed');
    const hasFailure = types.has('booking_failed') || types.has('booking_client_error');
    const crmWarning = types.has('booking_crm_sync_warning');
    const submitted = types.has('booking_submitted');
    const state = crmWarning ? 'Booking confirmed — CRM needs review'
      : hasConfirmed ? 'Booked'
      : hasFailure ? 'Booking failed'
      : submitted ? 'Submitted — outcome not recorded'
      : types.has('slot_selected') ? 'Time chosen, not submitted'
      : types.has('availability_viewed') ? 'Viewed available times'
      : types.has('invitation_rejected') ? 'Invitation not matched'
      : types.has('invitation_verified') ? 'Invitation verified'
      : 'Opened scheduler';
    return {
      id, events: ordered, organizationId: lastMatched?.organization_id ?? null,
      opportunityId: [...ordered].reverse().find((e) => e.opportunity_id)?.opportunity_id ?? null,
      selectedTime: selected?.requested_start_utc ?? null,
      latest: ordered[ordered.length - 1].created_at,
      state, needsAttention: crmWarning || !hasConfirmed && (hasFailure || submitted),
    };
  }).sort((a, b) => b.latest.localeCompare(a.latest));
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('en-US', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Chicago',
  }) + ' CT';
}

export default function BtySchedulingActivityPage() {
  const [search, setSearch] = useState('');
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [days, setDays] = useState(7);

  const activity = useQuery({
    queryKey: ['bty-scheduler-activity-events', days],
    queryFn: async () => {
      const from = new Date(Date.now() - days * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from('bty_scheduler_activity_events')
        .select('id,created_at,visitor_session_id,booking_attempt_id,organization_id,opportunity_id,event_type,meeting_type,requested_start_utc,failure_code,failure_stage,http_status')
        .gte('created_at', from)
        .order('created_at', { ascending: false })
        .limit(1500);
      if (error) throw error;
      return (data ?? []) as FunnelEvent[];
    },
    retry: false,
    refetchInterval: 60_000,
  });

  const orgIds = useMemo(
    () => Array.from(new Set((activity.data ?? []).map((e) => e.organization_id).filter((id): id is string => Boolean(id)))),
    [activity.data],
  );
  const organizations = useQuery({
    queryKey: ['bty-scheduler-activity-organizations', orgIds],
    enabled: orgIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('relationship_organizations')
        .select('id,name').in('id', orgIds);
      if (error) throw error;
      return new Map((data ?? []).map((org) => [org.id, org.name] as const));
    },
    retry: false,
  });

  const allSessions = useMemo(() => summarize(activity.data ?? []), [activity.data]);
  const visible = allSessions.filter((session) => {
    const name = organizations.data?.get(session.organizationId ?? '') ?? 'Unidentified visitor';
    const matches = name.toLowerCase().includes(search.toLowerCase()) ||
      session.id.toLowerCase().startsWith(search.toLowerCase());
    return matches && (!attentionOnly || session.needsAttention);
  });
  const submitted = allSessions.filter((x) => x.events.some((e) => e.event_type === 'booking_submitted')).length;
  const booked = allSessions.filter((x) => x.events.some((e) => e.event_type === 'booking_confirmed')).length;
  const abandoned = allSessions.filter((x) => x.events.some((e) => e.event_type === 'slot_selected') &&
    !x.events.some((e) => e.event_type === 'booking_submitted')).length;
  const issues = allSessions.filter((x) => x.needsAttention).length;

  return <div className="space-y-6 p-4 md:p-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-3xl font-bold">BTY Scheduling Activity</h1>
        <p className="mt-2 text-muted-foreground">Follow each visitor from opening the scheduler to choosing a time, submitting, and receiving a confirmed appointment. Central Time. Tracking begins on deployment; older visits are not reconstructed.</p>
      </div>
      <Button variant="outline" onClick={() => void activity.refetch()}>
        <RefreshCw className="mr-2 h-4 w-4" />Refresh
      </Button>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {[
        { label: 'Visitor sessions', value: allSessions.length, icon: Activity },
        { label: 'Booking submissions', value: submitted, icon: Clock },
        { label: 'Confirmed bookings', value: booked, icon: CalendarCheck },
        { label: 'Follow-up needed', value: issues, icon: AlertCircle },
      ].map(({ label, value, icon: Icon }) =>
        <Card key={label}><CardContent className="flex items-center gap-3 p-4">
          <Icon className="h-5 w-5 text-muted-foreground" />
          <div><p className="text-2xl font-bold tabular-nums">{value}</p>
            <p className="text-xs text-muted-foreground">{label}</p></div>
        </CardContent></Card>,
      )}
    </div>
    <Card>
      <CardHeader><CardTitle>Visitor timeline</CardTitle>
        <CardDescription>{abandoned} visitor session(s) selected a time without submitting. Successful requests without a booking are not treated as confirmed appointments.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        <Input className="min-w-52 flex-1" placeholder="Filter by organization or session ID" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Time range">
          <option value={1}>Past 24 hours</option>
          <option value={7}>Past 7 days</option>
          <option value={30}>Past 30 days</option>
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={attentionOnly} onChange={(e) => setAttentionOnly(e.target.checked)} />Needs follow-up
        </label>
      </CardContent>
    </Card>
    {activity.isLoading && <p className="text-muted-foreground">Loading scheduling activity…</p>}
    {activity.isError && <Card><CardContent className="p-4 text-destructive">
      Tracking events could not be read: {activity.error instanceof Error ? activity.error.message : 'Unknown error'}
    </CardContent></Card>}
    {organizations.isError && <p className="text-sm text-destructive">Organization names couldn't be loaded. Session IDs remain visible.</p>}
    {activity.isSuccess && allSessions.length === 0 && <Card><CardContent className="p-5 text-muted-foreground">
      No tracking events yet. Open the scheduling page after deployment to verify the first page-opened event.
    </CardContent></Card>}
    {visible.map((session) => {
      const name = organizations.data?.get(session.organizationId ?? '') ?? 'Unidentified visitor';
      const lastSelected = session.selectedTime ? formatDate(session.selectedTime) : null;
      return <Card key={session.id}>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle className="text-lg">{session.organizationId
                ? <Link className="hover:underline" to={'/crm/business-development/organizations/' + session.organizationId}>{name}</Link>
                : name}</CardTitle>
              <CardDescription>Last activity: {formatDate(session.latest)} · Session {session.id.slice(0, 8)}</CardDescription>
            </div>
            <Badge variant={session.needsAttention ? 'destructive' : 'secondary'}>{session.state}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {lastSelected && <p className="text-sm"><strong>Time selected:</strong> {lastSelected}</p>}
          {session.opportunityId && <Link className="text-sm text-primary underline" to={'/crm/business-development/opportunities/' + session.opportunityId}>Open BTY opportunity</Link>}
          <ol className="space-y-2 border-l-2 pl-4">
            {session.events.map((event) => <li key={event.id} className="text-sm">
              <span className="font-medium">{labels[event.event_type] ?? event.event_type}</span>
              <span className="ml-2 text-xs text-muted-foreground">{formatDate(event.created_at)}</span>
              {event.requested_start_utc &&
                <span className="block text-xs text-muted-foreground">Requested: {formatDate(event.requested_start_utc)}</span>}
              {event.failure_code &&
                <span className="block text-xs text-destructive">Reason: {event.failure_code.replaceAll('_', ' ')}
                  {event.failure_stage ? ' · ' + event.failure_stage.replaceAll('_', ' ') : ''}
                  {event.http_status ? ' · HTTP ' + event.http_status : ''}
                </span>}
            </li>)}
          </ol>
        </CardContent>
      </Card>;
    })}
    {activity.isSuccess && visible.length === 0 && allSessions.length > 0 &&
      <p className="text-sm text-muted-foreground">No sessions match these filters.</p>}
    {activity.data?.length === 1500 &&
      <p className="text-sm text-amber-700">Only the 1,500 most recent events are displayed. Narrow the date range if needed.</p>}
  </div>;
}
