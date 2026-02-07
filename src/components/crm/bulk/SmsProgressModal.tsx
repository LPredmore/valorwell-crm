import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { CheckCircle2, XCircle, Loader2, MessageSquare } from 'lucide-react';
import type { BulkSmsStatus } from '@/hooks/crm/useBulkSmsStatus';

interface SmsProgressModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: BulkSmsStatus;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
}

export function SmsProgressModal({
  open,
  onOpenChange,
  status,
  recipientCount,
  sentCount,
  failedCount,
}: SmsProgressModalProps) {
  const processedCount = sentCount + failedCount;
  const progressPercent = recipientCount > 0 
    ? Math.round((processedCount / recipientCount) * 100) 
    : 0;

  const isComplete = status === 'completed' || status === 'failed';

  const getStatusIcon = () => {
    switch (status) {
      case 'pending':
        return <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />;
      case 'sending':
        return <MessageSquare className="h-8 w-8 text-primary animate-pulse" />;
      case 'completed':
        return <CheckCircle2 className="h-8 w-8 text-green-500" />;
      case 'failed':
        return <XCircle className="h-8 w-8 text-destructive" />;
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'pending':
        return 'Preparing to send texts...';
      case 'sending':
        return 'Sending texts...';
      case 'completed':
        return 'All texts sent!';
      case 'failed':
        return 'Sending failed';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            {getStatusIcon()}
            <span>{getStatusText()}</span>
          </DialogTitle>
          <DialogDescription>
            {isComplete 
              ? `Processed ${recipientCount} recipient${recipientCount !== 1 ? 's' : ''}`
              : `Processing ${recipientCount} recipient${recipientCount !== 1 ? 's' : ''}...`
            }
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <Progress value={progressPercent} className="h-2" />
          
          <div className="flex justify-between text-sm">
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
              <CheckCircle2 className="h-4 w-4" />
              <span>{sentCount} sent</span>
            </div>
            
            {failedCount > 0 && (
              <div className="flex items-center gap-2 text-destructive">
                <XCircle className="h-4 w-4" />
                <span>{failedCount} failed</span>
              </div>
            )}
            
            <div className="text-muted-foreground">
              {processedCount} / {recipientCount}
            </div>
          </div>

          {status === 'sending' && (
            <p className="text-xs text-muted-foreground text-center">
              Texts are sent at a rate of ~30 per minute to comply with carrier limits.
              {recipientCount > 30 && ` Estimated time: ~${Math.ceil(recipientCount / 30)} minutes.`}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
