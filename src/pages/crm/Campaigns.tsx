import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, MoreHorizontal, Pencil, Trash2, Users, Play, Pause, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useCampaigns, useDeleteCampaign, useToggleCampaignActive, useDuplicateCampaign } from '@/hooks/crm/useCampaigns';
import type { CrmCampaign } from '@/lib/crm/campaign-types';

export default function Campaigns() {
  const navigate = useNavigate();
  const { data: campaigns, isLoading } = useCampaigns();
  const deleteCampaign = useDeleteCampaign();
  const toggleActive = useToggleCampaignActive();
  const duplicateCampaign = useDuplicateCampaign();
  const [deleteTarget, setDeleteTarget] = useState<CrmCampaign | null>(null);

  const handleDelete = () => {
    if (deleteTarget) {
      deleteCampaign.mutate(deleteTarget.id, {
        onSuccess: () => setDeleteTarget(null),
      });
    }
  };

  const formatTimeWindow = (start: string, end: string) => {
    const formatTime = (t: string) => {
      const [h, m] = t.split(':');
      const hour = parseInt(h);
      const ampm = hour >= 12 ? 'PM' : 'AM';
      const hour12 = hour % 12 || 12;
      return `${hour12}:${m} ${ampm}`;
    };
    return `${formatTime(start)} - ${formatTime(end)}`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Campaigns</h1>
          <p className="text-muted-foreground">
            Automated multi-step email and SMS outreach sequences
          </p>
        </div>
        <Button onClick={() => navigate('/crm/campaigns/new')} className="gap-2">
          <Plus className="h-4 w-4" />
          New Campaign
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Steps</TableHead>
              <TableHead>Active Enrollments</TableHead>
              <TableHead>Send Window</TableHead>
              <TableHead className="w-[70px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-12" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-28" /></TableCell>
                  <TableCell><Skeleton className="h-8 w-8" /></TableCell>
                </TableRow>
              ))
            ) : campaigns && campaigns.length > 0 ? (
              campaigns.map((campaign) => (
                <TableRow key={campaign.id}>
                  <TableCell>
                    <div>
                      <p className="font-medium">{campaign.name}</p>
                      {campaign.description && (
                        <p className="text-sm text-muted-foreground truncate max-w-xs">
                          {campaign.description}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={campaign.is_active ? 'default' : 'secondary'}>
                      {campaign.is_active ? 'Active' : 'Paused'}
                    </Badge>
                  </TableCell>
                  <TableCell>{campaign.steps_count || 0}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      {campaign.active_enrollments_count || 0}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatTimeWindow(campaign.send_window_start, campaign.send_window_end)}
                    {campaign.weekdays_only && (
                      <span className="ml-1 text-xs">(weekdays)</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => navigate(`/crm/campaigns/${campaign.id}`)}
                        >
                          <Pencil className="h-4 w-4 mr-2" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => navigate(`/crm/campaigns/${campaign.id}/enrollments`)}
                        >
                          <Users className="h-4 w-4 mr-2" />
                          View Enrollments
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            duplicateCampaign.mutate(campaign, {
                              onSuccess: (newId) => navigate(`/crm/campaigns/${newId}`),
                            })
                          }
                        >
                          <Copy className="h-4 w-4 mr-2" />
                          Duplicate
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            toggleActive.mutate({
                              campaignId: campaign.id,
                              isActive: !campaign.is_active,
                            })
                          }
                        >
                          {campaign.is_active ? (
                            <>
                              <Pause className="h-4 w-4 mr-2" />
                              Pause
                            </>
                          ) : (
                            <>
                              <Play className="h-4 w-4 mr-2" />
                              Activate
                            </>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => setDeleteTarget(campaign)}
                          className="text-destructive"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">
                  <p className="text-muted-foreground">No campaigns yet</p>
                  <Button
                    variant="link"
                    onClick={() => navigate('/crm/campaigns/new')}
                    className="mt-2"
                  >
                    Create your first campaign
                  </Button>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Campaign</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteTarget?.name}"? This will also remove all
              enrollments and step logs. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
