import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, MoreHorizontal, Pause, Play, X, CheckCircle2, RotateCcw, UserPlus } from 'lucide-react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { useCampaign } from '@/hooks/crm/useCampaigns';
import { useCampaignSteps } from '@/hooks/crm/useCampaignSteps';
import {
  useCampaignEnrollments,
  useEnrollmentAction,
} from '@/hooks/crm/useCampaignEnrollments';
import type { EnrollmentStatus } from '@/lib/crm/campaign-types';

type EnrollmentAction = 'pause' | 'resume' | 'cancel' | 'responded' | 'restart';

const ACTION_TITLE: Record<EnrollmentAction, string> = {
  pause: 'Pause Enrollment',
  resume: 'Resume Enrollment',
  cancel: 'Cancel Enrollment',
  responded: 'Mark as Responded',
  restart: 'Restart Enrollment',
};

const ACTION_DESCRIPTION: Record<EnrollmentAction, string> = {
  pause: 'Pauses this enrollment and suppresses upcoming scheduled steps until resumed.',
  resume: 'Resumes the enrollment. Previously suppressed future steps become scheduled again.',
  cancel: 'Cancels the enrollment permanently. Scheduled steps are suppressed. Historical record is preserved.',
  responded: 'Marks the client as having responded. Scheduled follow-up steps are suppressed.',
  restart: 'Creates a new enrollment in this campaign for the same client. The historical record is preserved.',
};

function renderStepLabel(
  enrollment: { status: EnrollmentStatus; current_step: number },
  totalSteps?: number,
) {
  if (enrollment.status === 'completed') return 'Completed';
  if (enrollment.status === 'cancelled') return 'Cancelled';
  if (enrollment.current_step === 0) return 'Not started';
  return totalSteps
    ? `Step ${enrollment.current_step} of ${totalSteps}`
    : `Step ${enrollment.current_step}`;
}

const STATUS_BADGE_VARIANTS: Record<EnrollmentStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  active: 'default',
  paused: 'secondary',
  completed: 'outline',
  cancelled: 'destructive',
  responded: 'outline',
};

export default function CampaignEnrollments() {
  const { id: campaignId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: campaign, isLoading: loadingCampaign } = useCampaign(campaignId);
  const { data: steps } = useCampaignSteps(campaignId);
  const { data: enrollments, isLoading: loadingEnrollments } = useCampaignEnrollments(campaignId);
  const runAction = useEnrollmentAction();

  const [pending, setPending] = useState<{ enrollmentId: string; action: EnrollmentAction } | null>(null);
  const [reason, setReason] = useState('');

  const getClientName = (enrollment: typeof enrollments extends (infer T)[] | undefined ? T : never) => {
    if (!enrollment.client) return 'Unknown Client';
    const { pat_name_preferred, pat_name_f, pat_name_l } = enrollment.client;
    return pat_name_preferred || [pat_name_f, pat_name_l].filter(Boolean).join(' ') || 'Unnamed';
  };

  const openAction = (enrollmentId: string, action: EnrollmentAction) => {
    setPending({ enrollmentId, action });
    setReason('');
  };

  const confirmAction = () => {
    if (!pending || reason.trim().length < 3) return;
    runAction.mutate(
      { enrollmentId: pending.enrollmentId, action: pending.action, reason: reason.trim() },
      { onSuccess: () => setPending(null) },
    );
  };

  const isLoading = loadingCampaign || loadingEnrollments;

  return (
    <div className="space-y-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/crm/campaigns">Campaigns</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to={`/crm/campaigns/${campaignId}`}>
                {campaign?.name || 'Campaign'}
              </Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Enrollments</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {loadingCampaign ? <Skeleton className="h-8 w-48" /> : `${campaign?.name} Enrollments`}
            </h1>
            <p className="text-muted-foreground">
              {loadingEnrollments ? (
                <Skeleton className="h-4 w-32 mt-1" />
              ) : (
                `${enrollments?.length || 0} total enrollments`
              )}
            </p>
          </div>
        </div>
        <Button
          onClick={() => navigate('/crm/clients')}
          variant="outline"
          className="gap-2"
        >
          <UserPlus className="h-4 w-4" />
          Enroll from Clients
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Current Step</TableHead>
              <TableHead>Enrolled</TableHead>
              <TableHead className="w-[70px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-12" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-8 w-8" /></TableCell>
                </TableRow>
              ))
            ) : enrollments && enrollments.length > 0 ? (
              enrollments.map((enrollment) => (
                <TableRow key={enrollment.id}>
                  <TableCell>
                    <Link
                      to={`/crm/clients/${enrollment.client_id}`}
                      className="font-medium hover:underline"
                    >
                      {getClientName(enrollment)}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">
                      {enrollment.client?.email && (
                        <div className="text-muted-foreground">{enrollment.client.email}</div>
                      )}
                      {enrollment.client?.phone && (
                        <div className="text-muted-foreground">{enrollment.client.phone}</div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE_VARIANTS[enrollment.status]}>
                      {enrollment.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {renderStepLabel(enrollment, steps?.length)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {format(new Date(enrollment.enrolled_at), 'MMM d, yyyy')}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {enrollment.status === 'active' && (
                          <>
                            <DropdownMenuItem onClick={() => openAction(enrollment.id, 'pause')}>
                              <Pause className="h-4 w-4 mr-2" />
                              Pause
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openAction(enrollment.id, 'responded')}>
                              <CheckCircle2 className="h-4 w-4 mr-2" />
                              Mark responded
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openAction(enrollment.id, 'cancel')}>
                              <X className="h-4 w-4 mr-2" />
                              Cancel
                            </DropdownMenuItem>
                          </>
                        )}
                        {enrollment.status === 'paused' && (
                          <>
                            <DropdownMenuItem onClick={() => openAction(enrollment.id, 'resume')}>
                              <Play className="h-4 w-4 mr-2" />
                              Resume
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openAction(enrollment.id, 'cancel')}>
                              <X className="h-4 w-4 mr-2" />
                              Cancel
                            </DropdownMenuItem>
                          </>
                        )}
                        {(enrollment.status === 'cancelled'
                          || enrollment.status === 'completed'
                          || enrollment.status === 'responded') && (
                          <DropdownMenuItem onClick={() => openAction(enrollment.id, 'restart')}>
                            <RotateCcw className="h-4 w-4 mr-2" />
                            Restart
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">
                  <p className="text-muted-foreground">No enrollments yet</p>
                  <Button
                    variant="link"
                    onClick={() => navigate('/crm/clients')}
                    className="mt-2"
                  >
                    Enroll clients from the Clients page
                  </Button>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!pending} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pending ? ACTION_TITLE[pending.action] : ''}</DialogTitle>
            <DialogDescription>
              {pending ? ACTION_DESCRIPTION[pending.action] : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="enrollment-reason">Reason (required)</Label>
            <Textarea
              id="enrollment-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why this action is being taken (min 3 characters)"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)} disabled={runAction.isPending}>
              Cancel
            </Button>
            <Button
              onClick={confirmAction}
              disabled={reason.trim().length < 3 || runAction.isPending}
            >
              {runAction.isPending ? 'Working…' : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
