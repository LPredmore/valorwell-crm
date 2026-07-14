import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangle, ShieldCheck, ShieldAlert } from 'lucide-react';
import type { CommunicationPolicyResult } from '@/domain/operations';

interface Props {
  policy: CommunicationPolicyResult | null;
  checking?: boolean;
}

/**
 * Renders the outcome of a server-side communication policy check.
 * Never trust the UI alone — the edge function (`crm_evaluate_communication_policy`
 * + suppression list) is the authoritative gate. This banner surfaces WHY a send
 * is allowed, blocked, or requires supervisor override.
 */
export function SuppressionBanner({ policy, checking }: Props) {
  if (checking) {
    return (
      <div className="text-xs text-muted-foreground">Checking communication policy…</div>
    );
  }
  if (!policy) return null;

  if (policy.allowed) {
    return (
      <Alert>
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle className="text-xs font-medium">Policy allows this send</AlertTitle>
        <AlertDescription className="text-xs">
          {policy.reasons.length ? policy.reasons.join(', ') : 'No suppression rules matched.'}
        </AlertDescription>
      </Alert>
    );
  }

  const Icon = policy.requiresReview ? ShieldAlert : AlertTriangle;
  return (
    <Alert variant="destructive">
      <Icon className="h-4 w-4" />
      <AlertTitle className="text-xs font-medium">
        Blocked — {policy.suppressionCode ?? 'SUPPRESSED'}
      </AlertTitle>
      <AlertDescription className="text-xs space-y-1">
        <div>{policy.reasons.join('; ') || 'Suppressed by server-side policy.'}</div>
        {policy.requiresReview && (
          <div className="font-medium">Requires supervisor review to override.</div>
        )}
      </AlertDescription>
    </Alert>
  );
}
