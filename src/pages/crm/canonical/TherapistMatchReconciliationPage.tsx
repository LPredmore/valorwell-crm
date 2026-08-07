import { type ReactNode, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  FileCheck2,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import {
  type TherapistMatchWorkRow,
  useConfirmLegacyRelationship,
  useRejectLegacyRelationship,
  useTherapistMatchReconciliation,
} from '@/hooks/crm/useTherapistMatchReconciliation';

type ReviewAction = 'confirm' | 'reject';

interface PendingDecision {
  action: ReviewAction;
  row: TherapistMatchWorkRow;
}

const newActionId = (prefix: string) => `${prefix}:${crypto.randomUUID()}`;

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export default function TherapistMatchReconciliationPage() {
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<'legacy' | 'pending' | 'all'>('legacy');
  const [decision, setDecision] = useState<PendingDecision | null>(null);
  const [reason, setReason] = useState('');

  const query = useTherapistMatchReconciliation({
    page: 1,
    pageSize: 100,
    scope,
    search,
  });
  const confirm = useConfirmLegacyRelationship();
  const reject = useRejectLegacyRelationship();

  const rows = query.data?.rows ?? [];
  const isAdmin = query.data?.isAdmin ?? false;

  const metrics = useMemo(() => ({
    legacyReview: rows.filter((row) => row.state === 'legacy_review').length,
    pendingAcceptance: rows.filter((row) => row.state === 'pending_clinician_acceptance').length,
    pendingBooking: rows.filter((row) => row.state === 'pending_first_appointment').length,
    noCareEvidence: rows.filter((row) =>
      row.state === 'legacy_review'
      && row.appointmentCount === 0
      && row.signedNoteCount === 0
      && !row.activeTreatmentPlan
    ).length,
  }), [rows]);

  const submitDecision = async () => {
    if (!decision || !decision.row.relationshipId || reason.trim().length < 10) return;

    const variables = {
      relationshipId: decision.row.relationshipId,
      priorVersion: decision.row.version,
      reason: reason.trim(),
      clientActionId: newActionId(
        decision.action === 'confirm' ? 'crm-legacy-confirm' : 'crm-legacy-reject',
      ),
    };

    try {
      if (decision.action === 'confirm') {
        await confirm.mutateAsync(variables);
        toast.success('Legacy therapist relationship confirmed');
      } else {
        await reject.mutateAsync(variables);
        toast.success('Legacy therapist relationship rejected', {
          description: 'The relationship was ended and a human follow-up task was created.',
        });
      }
      setDecision(null);
      setReason('');
    } catch (error) {
      toast.error('Reconciliation action failed', {
        description: error instanceof Error ? error.message : 'Refresh the queue and try again.',
      });
    }
  };

  const isSubmitting = confirm.isPending || reject.isPending;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight">
            <ShieldCheck className="h-8 w-8 text-primary" />
            Therapist Relationship Reconciliation
          </h1>
          <p className="mt-1 text-muted-foreground">
            Resolve legacy therapist associations using the Billing Hub authority model.
          </p>
        </div>
        <Button variant="outline" onClick={() => query.refetch()} disabled={query.isFetching}>
          <RefreshCw className={`mr-2 h-4 w-4 ${query.isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Legacy review" value={metrics.legacyReview} icon={<ShieldCheck className="h-5 w-5" />} />
        <Metric label="Awaiting clinician" value={metrics.pendingAcceptance} icon={<Clock3 className="h-5 w-5" />} />
        <Metric label="Awaiting booking" value={metrics.pendingBooking} icon={<FileCheck2 className="h-5 w-5" />} />
        <Metric label="No care evidence" value={metrics.noCareEvidence} icon={<AlertCircle className="h-5 w-5" />} />
      </div>

      <Card>
        <CardHeader><CardTitle>Filters</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1fr_240px]">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search client, email, or therapist"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <Select value={scope} onValueChange={(value) => setScope(value as typeof scope)}>
            <SelectTrigger><SelectValue placeholder="Queue" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="legacy">Legacy reconciliation</SelectItem>
              <SelectItem value="pending">Pending matches</SelectItem>
              <SelectItem value="all">All match work</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {!isAdmin && !query.isLoading && (
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-3 py-6 text-destructive">
            <AlertCircle className="h-5 w-5" />
            Administrator authorization is required for legacy reconciliation.
          </CardContent>
        </Card>
      )}

      {query.error && (
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-3 py-6 text-destructive">
            <AlertCircle className="h-5 w-5" />
            {query.error instanceof Error ? query.error.message : 'Unable to load therapist match work.'}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Reconciliation queue</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Therapist</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Care evidence</TableHead>
                  <TableHead>Recommendation</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                      <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                      Loading reconciliation work…
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                      No therapist match work matches these filters.
                    </TableCell>
                  </TableRow>
                ) : rows.map((row) => (
                  <TableRow key={`${row.workType}-${row.id}`}>
                    <TableCell>
                      <Link
                        to={`/crm/clients/${row.clientId}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {row.clientDisplayName || 'Client record'}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {row.clientEmail || 'No email'} · {row.lifecycleStage.replaceAll('_', ' ')}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{row.staffDisplayName}</div>
                      <div className="text-xs text-muted-foreground">
                        {row.staffStatus} · {row.staffAcceptingNewClients ? 'accepting' : 'not accepting new clients'}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={row.state === 'legacy_review' ? 'secondary' : 'outline'}
                        className="capitalize"
                      >
                        {row.state.replaceAll('_', ' ')}
                      </Badge>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Opened {formatDate(row.openedAt)}
                      </div>
                    </TableCell>
                    <TableCell>
                      {row.workType === 'legacy_relationship' ? (
                        <div className="space-y-1 text-xs">
                          <div>{row.appointmentCount} appointments · {row.documentedAppointmentCount} documented</div>
                          <div>{row.signedNoteCount} signed notes · {row.activeTreatmentPlan ? 'active plan' : 'no active plan'}</div>
                          <div className="text-muted-foreground">Latest: {formatDate(row.latestCareAt)}</div>
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">New match workflow</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[260px] text-sm capitalize">
                      {row.recommendedAction.replaceAll('_', ' ')}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.state === 'legacy_review' && row.relationshipId && isAdmin ? (
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            onClick={() => {
                              setDecision({ action: 'confirm', row });
                              setReason('');
                            }}
                            disabled={isSubmitting}
                          >
                            <CheckCircle2 className="mr-1 h-4 w-4" />
                            Confirm
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => {
                              setDecision({ action: 'reject', row });
                              setReason('');
                            }}
                            disabled={isSubmitting}
                          >
                            <XCircle className="mr-1 h-4 w-4" />
                            Reject
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {row.state === 'pending_clinician_acceptance'
                            ? 'Clinician action in staff portal'
                            : 'No CRM action required'}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!decision} onOpenChange={(open) => !open && setDecision(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {decision?.action === 'confirm'
                ? 'Confirm legacy therapist relationship'
                : 'Reject legacy therapist relationship'}
            </DialogTitle>
            <DialogDescription>
              {decision?.action === 'confirm'
                ? 'Confirm only when the record supports a current active therapist relationship.'
                : 'Rejecting ends the unconfirmed relationship, recalculates the client journey, and creates a follow-up task. No automatic client message is sent.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="crm-therapist-match-reason">Documented rationale</Label>
            <Textarea
              id="crm-therapist-match-reason"
              rows={5}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Describe the evidence and decision rationale."
            />
            <p className="text-xs text-muted-foreground">
              At least 10 characters. This is written to the reconciliation audit record.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecision(null)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button
              variant={decision?.action === 'reject' ? 'destructive' : 'default'}
              onClick={submitDecision}
              disabled={reason.trim().length < 10 || isSubmitting}
            >
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Submit decision
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Metric({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-6">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold">{value}</p>
        </div>
        <div className="rounded-full bg-primary/10 p-3 text-primary">{icon}</div>
      </CardContent>
    </Card>
  );
}
