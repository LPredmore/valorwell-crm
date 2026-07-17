import { useCrmAuth } from '@/hooks/crm/useCrmAuth';
import type { CrmCapabilities } from '@/lib/crm/types';
import type { ReactNode } from 'react';

/**
 * Hides mutating controls for users without the requested CRM capability.
 * Server-side RPCs remain the source of truth — this is UI hygiene only.
 *
 * Legacy `allow` prop kept for source-compat; capability check wins.
 */
export function CrmMutationGate({
  children,
  readOnlyFallback = null,
  capability = 'mutate',
}: {
  children: ReactNode;
  readOnlyFallback?: ReactNode;
  allow?: Array<'admin' | 'staff'>; // legacy, ignored
  capability?: keyof CrmCapabilities;
}) {
  const { isAuthenticated, isLoading, capabilities } = useCrmAuth();
  if (isLoading) return <>{readOnlyFallback}</>;
  if (!isAuthenticated) return <>{readOnlyFallback}</>;
  if (!capabilities?.[capability]) return <>{readOnlyFallback}</>;
  return <>{children}</>;
}
