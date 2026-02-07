import { useState } from 'react';
import { Megaphone, AlertCircle, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useCampaigns } from '@/hooks/crm/useCampaigns';
import { useEnrollClients } from '@/hooks/crm/useCampaignEnrollments';

interface EnrollInCampaignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientIds: string[];
  onSuccess?: () => void;
}

export function EnrollInCampaignDialog({
  open,
  onOpenChange,
  clientIds,
  onSuccess,
}: EnrollInCampaignDialogProps) {
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('');
  const { data: campaigns, isLoading: loadingCampaigns } = useCampaigns();
  const enrollClients = useEnrollClients();

  // Only show active campaigns with at least one step
  const activeCampaigns = campaigns?.filter(c => c.is_active && (c.steps_count || 0) > 0) || [];

  const handleEnroll = async () => {
    if (!selectedCampaignId || clientIds.length === 0) return;

    await enrollClients.mutateAsync({
      campaignId: selectedCampaignId,
      clientIds,
    });

    setSelectedCampaignId('');
    onOpenChange(false);
    onSuccess?.();
  };

  const handleClose = () => {
    setSelectedCampaignId('');
    onOpenChange(false);
  };

  const clientLabel = clientIds.length === 1 ? '1 client' : `${clientIds.length} clients`;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Megaphone className="h-5 w-5" />
            Enroll in Campaign
          </DialogTitle>
          <DialogDescription>
            Select a campaign to enroll {clientLabel}. Clients already in an active campaign will be skipped.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          {loadingCampaigns ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : activeCampaigns.length === 0 ? (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                No active campaigns available. Create a campaign with at least one step first.
              </AlertDescription>
            </Alert>
          ) : (
            <Select value={selectedCampaignId} onValueChange={setSelectedCampaignId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a campaign..." />
              </SelectTrigger>
              <SelectContent>
                {activeCampaigns.map((campaign) => (
                  <SelectItem key={campaign.id} value={campaign.id}>
                    <div className="flex flex-col">
                      <span>{campaign.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {campaign.steps_count} step{campaign.steps_count !== 1 ? 's' : ''} • 
                        {campaign.active_enrollments_count || 0} enrolled
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={handleEnroll}
            disabled={!selectedCampaignId || enrollClients.isPending || activeCampaigns.length === 0}
          >
            {enrollClients.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Enrolling...
              </>
            ) : (
              `Enroll ${clientLabel}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
