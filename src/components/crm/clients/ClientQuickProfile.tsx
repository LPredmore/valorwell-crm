import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { Mail, Phone, MapPin, User, ExternalLink, Megaphone, Pause, Play, X } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from './StatusBadge';
import { useUpdateClientStatus } from '@/hooks/crm/useUpdateClientStatus';
import { useClientActiveEnrollment, useUpdateEnrollmentStatus } from '@/hooks/crm/useCampaignEnrollments';
import {
  getClientDisplayName,
  getTherapistDisplayName,
  ALL_STATUSES,
  STATUS_CONFIG,
  type StatusCategory,
} from '@/lib/crm/status-config';
import type { CrmClient, PatStatus } from '@/lib/crm/types';

interface ClientQuickProfileProps {
  client: CrmClient | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Group statuses by category for the select
const STATUS_CATEGORIES: { label: string; category: StatusCategory }[] = [
  { label: 'Lead', category: 'lead' },
  { label: 'Onboarding', category: 'onboarding' },
  { label: 'Active', category: 'active' },
  { label: 'Inactive', category: 'inactive' },
  { label: 'Closed', category: 'closed' },
];

function getStatusesByCategory(category: StatusCategory): PatStatus[] {
  return ALL_STATUSES.filter(status => STATUS_CONFIG[status].category === category)
    .sort((a, b) => STATUS_CONFIG[a].order - STATUS_CONFIG[b].order);
}

export function ClientQuickProfile({
  client,
  open,
  onOpenChange,
}: ClientQuickProfileProps) {
  const navigate = useNavigate();
  const updateStatus = useUpdateClientStatus();
  const [enrollDialogOpen, setEnrollDialogOpen] = useState(false);
  
  // Fetch active enrollment for this client
  const { data: activeEnrollment, isLoading: loadingEnrollment } = useClientActiveEnrollment(client?.id);
  const updateEnrollmentStatus = useUpdateEnrollmentStatus();

  if (!client) return null;

  const displayName = getClientDisplayName(client);
  const preferredName = client.pat_name_preferred;
  const showPreferredName = preferredName && preferredName !== displayName;
  const therapistName = getTherapistDisplayName(client.primary_staff);
  const joinedDate = format(new Date(client.created_at), 'MMMM d, yyyy');

  const handleStatusChange = (newStatus: string) => {
    if (newStatus !== client.pat_status) {
      updateStatus.mutate({
        clientId: client.id,
        newStatus: newStatus as PatStatus,
        oldStatus: client.pat_status,
      });
    }
  };

  const handleViewFullProfile = () => {
    onOpenChange(false);
    navigate(`/crm/clients/${client.id}`);
  };

  const handlePauseEnrollment = () => {
    if (activeEnrollment) {
      updateEnrollmentStatus.mutate({
        enrollmentId: activeEnrollment.id,
        status: 'paused',
      });
    }
  };

  const handleResumeEnrollment = () => {
    if (activeEnrollment) {
      updateEnrollmentStatus.mutate({
        enrollmentId: activeEnrollment.id,
        status: 'active',
      });
    }
  };

  const handleCancelEnrollment = () => {
    if (activeEnrollment) {
      updateEnrollmentStatus.mutate({
        enrollmentId: activeEnrollment.id,
        status: 'cancelled',
      });
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="text-xl">
            {displayName}
            {showPreferredName && (
              <span className="text-muted-foreground font-normal text-base ml-2">
                ({preferredName})
              </span>
            )}
          </SheetTitle>
          <SheetDescription>Client since {joinedDate}</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Contact Information */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Contact
            </h4>
            
            <div className="space-y-2">
              {client.email ? (
                <a
                  href={`mailto:${client.email}`}
                  className="flex items-center gap-3 p-2 rounded-md hover:bg-muted transition-colors"
                >
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-primary underline-offset-4 hover:underline">
                    {client.email}
                  </span>
                </a>
              ) : (
                <div className="flex items-center gap-3 p-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">No email</span>
                </div>
              )}

              {client.phone ? (
                <a
                  href={`tel:${client.phone}`}
                  className="flex items-center gap-3 p-2 rounded-md hover:bg-muted transition-colors"
                >
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-primary underline-offset-4 hover:underline">
                    {client.phone}
                  </span>
                </a>
              ) : (
                <div className="flex items-center gap-3 p-2">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">No phone</span>
                </div>
              )}

              <div className="flex items-center gap-3 p-2">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">
                  {client.pat_state || <span className="text-muted-foreground">No state</span>}
                </span>
              </div>
            </div>
          </div>

          <Separator />

          {/* Therapist */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Primary Therapist
            </h4>
            <div className="flex items-center gap-3 p-2">
              <User className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">{therapistName}</span>
            </div>
          </div>

          <Separator />

          {/* Status */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Status
            </h4>
            
            <div className="flex items-center gap-3 mb-3">
              <span className="text-sm text-muted-foreground">Current:</span>
              <StatusBadge status={client.pat_status} />
            </div>

            <Select
              value={client.pat_status || undefined}
              onValueChange={handleStatusChange}
              disabled={updateStatus.isPending}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Change status..." />
              </SelectTrigger>
              <SelectContent>
                {STATUS_CATEGORIES.map(({ label, category }) => {
                  const statuses = getStatusesByCategory(category);
                  if (statuses.length === 0) return null;
                  
                  return (
                    <SelectGroup key={category}>
                      <SelectLabel>{label}</SelectLabel>
                      {statuses.map(status => {
                        const config = STATUS_CONFIG[status];
                        return (
                          <SelectItem key={status} value={status}>
                            <div className="flex items-center gap-2">
                              <span
                                className="h-2 w-2 rounded-full"
                                style={{ backgroundColor: config.color }}
                              />
                              {config.label}
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectGroup>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          <Separator />

          {/* Campaign Enrollment */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Campaign
            </h4>
            
            {loadingEnrollment ? (
              <Skeleton className="h-10 w-full" />
            ) : activeEnrollment ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Megaphone className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">
                      {activeEnrollment.campaign?.name || 'Unknown Campaign'}
                    </span>
                  </div>
                  <Badge variant={activeEnrollment.status === 'active' ? 'default' : 'secondary'}>
                    {activeEnrollment.status}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  {activeEnrollment.status === 'active' && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1"
                      onClick={handlePauseEnrollment}
                      disabled={updateEnrollmentStatus.isPending}
                    >
                      <Pause className="h-3 w-3" />
                      Pause
                    </Button>
                  )}
                  {activeEnrollment.status === 'paused' && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1"
                      onClick={handleResumeEnrollment}
                      disabled={updateEnrollmentStatus.isPending}
                    >
                      <Play className="h-3 w-3" />
                      Resume
                    </Button>
                  )}
                  {(activeEnrollment.status === 'active' || activeEnrollment.status === 'paused') && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1 text-destructive hover:text-destructive"
                      onClick={handleCancelEnrollment}
                      disabled={updateEnrollmentStatus.isPending}
                    >
                      <X className="h-3 w-3" />
                      Cancel
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2"
                onClick={() => setEnrollDialogOpen(true)}
              >
                <Megaphone className="h-4 w-4" />
                Enroll in Campaign
              </Button>
            )}
          </div>
        </div>

        <SheetFooter className="mt-8">
          <Button
            variant="outline"
            className="w-full gap-2"
            onClick={handleViewFullProfile}
          >
            <ExternalLink className="h-4 w-4" />
            View Full Profile
          </Button>
        </SheetFooter>
      </SheetContent>

      {/* Enrollment Dialog */}
      <EnrollInCampaignDialog
        open={enrollDialogOpen}
        onOpenChange={setEnrollDialogOpen}
        clientIds={client ? [client.id] : []}
      />
    </Sheet>
  );
}
