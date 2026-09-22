import { AlertTriangle } from 'lucide-react';
import { SocialMediaError } from '@/lib/crm/social-media';

/** Renders enough detail to act on -- action, HTTP status, server requestId -- instead of
 * a bare "Something went wrong." Every social-media-manager query surfaces this on error;
 * none of them should silently render nothing. */
export function SocialMediaErrorState({ error }: { error: unknown }) {
  const isKnown = error instanceof SocialMediaError;
  const title = isKnown ? error.message : error instanceof Error ? error.message : 'Something went wrong.';

  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 space-y-1">
      <div className="flex items-center gap-2 text-sm font-medium text-destructive">
        <AlertTriangle className="h-4 w-4" />
        Social Media Manager request failed
      </div>
      <p className="text-sm text-destructive">{title}</p>
      {isKnown && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-xs text-muted-foreground pt-1">
          <dt>Action:</dt><dd className="font-mono">{error.action}</dd>
          {error.status !== null && (<><dt>HTTP:</dt><dd>{error.status}</dd></>)}
          {error.requestId && (<><dt>Request ID:</dt><dd className="font-mono">{error.requestId}</dd></>)}
        </dl>
      )}
    </div>
  );
}
