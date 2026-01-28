import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { CheckCircle, XCircle, Loader2, AlertTriangle } from 'lucide-react';

export type BulkSendStatus = 'pending' | 'sending' | 'completed' | 'failed';

interface BulkProgressModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: BulkSendStatus;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
}

export function BulkProgressModal({
  open,
  onOpenChange,
  status,
  recipientCount,
  sentCount,
  failedCount,
}: BulkProgressModalProps) {
  const processedCount = sentCount + failedCount;
  const progress = recipientCount > 0 ? (processedCount / recipientCount) * 100 : 0;
  const isComplete = status === 'completed' || status === 'failed';

  const handleOpenChange = (newOpen: boolean) => {
    // Only allow closing when complete
    if (isComplete || !newOpen) {
      onOpenChange(newOpen);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {status === 'sending' && (
              <>
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                Sending Emails...
              </>
            )}
            {status === 'completed' && failedCount === 0 && (
              <>
                <CheckCircle className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                Emails Sent Successfully
              </>
            )}
            {status === 'completed' && failedCount > 0 && (
              <>
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                Emails Sent with Issues
              </>
            )}
            {status === 'failed' && (
              <>
                <XCircle className="h-5 w-5 text-destructive" />
                Sending Failed
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {status === 'sending' && `Processing ${processedCount} of ${recipientCount} recipients...`}
            {isComplete && `Processed ${recipientCount} recipient${recipientCount !== 1 ? 's' : ''}`}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          <Progress value={progress} className="h-2" />
          
        <div className="flex justify-center gap-6 text-sm">
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
              <CheckCircle className="h-4 w-4" />
              <span>{sentCount} sent</span>
            </div>
            {failedCount > 0 && (
              <div className="flex items-center gap-2 text-destructive">
                <XCircle className="h-4 w-4" />
                <span>{failedCount} failed</span>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          {isComplete && (
            <Button onClick={() => handleOpenChange(false)}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
