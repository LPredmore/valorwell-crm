import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import type { ValidationResult } from '@/lib/crm/social-media';

export function SocialPublicationPreflight({ validation }: { validation: ValidationResult | undefined }) {
  if (!validation) return null;

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        {validation.ok ? (
          <><CheckCircle2 className="h-4 w-4 text-green-600" /> Ready to approve</>
        ) : (
          <><XCircle className="h-4 w-4 text-destructive" /> Not ready</>
        )}
      </div>
      {validation.errors.map((message, index) => (
        <p key={`error-${index}`} className="flex items-start gap-2 text-xs text-destructive">
          <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {message}
        </p>
      ))}
      {validation.warnings.map((message, index) => (
        <p key={`warning-${index}`} className="flex items-start gap-2 text-xs text-amber-600">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {message}
        </p>
      ))}
    </div>
  );
}
