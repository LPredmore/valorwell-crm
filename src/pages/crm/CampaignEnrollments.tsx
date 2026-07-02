import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, MoreHorizontal, Pause, Play, X, Trash2, UserPlus } from 'lucide-react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
  useUpdateEnrollmentStatus,
  useDeleteEnrollment,
} from '@/hooks/crm/useCampaignEnrollments';
import type { EnrollmentStatus } from '@/lib/crm/campaign-types';

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
  const updateStatus = useUpdateEnrollmentStatus();
  const deleteEnrollment = useDeleteEnrollment();

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const getClientName = (enrollment: typeof enrollments extends (infer T)[] | undefined ? T : never) => {
    if (!enrollment.client) return 'Unknown Client';
    const { pat_name_preferred, pat_name_f, pat_name_l } = enrollment.client;
    return pat_name_preferred || [pat_name_f, pat_name_l].filter(Boolean).join(' ') || 'Unnamed';
  };

  const handleStatusChange = (enrollmentId: string, newStatus: EnrollmentStatus) => {
    updateStatus.mutate({ enrollmentId, status: newStatus });
  };

  const handleDelete = () => {
    if (deleteTarget) {
      deleteEnrollment.mutate(deleteTarget, {
        onSuccess: () => setDeleteTarget(null),
      });
    }
  };

  const isLoading = loadingCampaign || loadingEnrollments;

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
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

      {/* Header */}
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

      {/* Table */}
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
                    {renderStepLabel(enrollment, campaign?.steps?.length)}
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
                          <DropdownMenuItem
                            onClick={() => handleStatusChange(enrollment.id, 'paused')}
                          >
                            <Pause className="h-4 w-4 mr-2" />
                            Pause
                          </DropdownMenuItem>
                        )}
                        {enrollment.status === 'paused' && (
                          <DropdownMenuItem
                            onClick={() => handleStatusChange(enrollment.id, 'active')}
                          >
                            <Play className="h-4 w-4 mr-2" />
                            Resume
                          </DropdownMenuItem>
                        )}
                        {(enrollment.status === 'active' || enrollment.status === 'paused') && (
                          <DropdownMenuItem
                            onClick={() => handleStatusChange(enrollment.id, 'cancelled')}
                          >
                            <X className="h-4 w-4 mr-2" />
                            Cancel
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => setDeleteTarget(enrollment.id)}
                          className="text-destructive"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Remove
                        </DropdownMenuItem>
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

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Enrollment</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove this client from the campaign? This will delete all
              associated step logs. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
