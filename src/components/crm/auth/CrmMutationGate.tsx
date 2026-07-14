import { useCrmAuth } from '@/hooks/crm/useCrmAuth';
import type { ReactNode } from 'react';

/**
 * Hides mutating controls for users without the admin/staff CRM role.
 * Renders `readOnlyFallback` (or nothing) when the current user is not
 * authorized. Server-side RPCs remain the source of truth — this is UI
 * hygiene only, never the sole gate.
 */
export function CrmMutationGate({
  children,
  readOnlyFallback = null,
  allow = ['admin', 'staff'],
}: {
  children: ReactNode;
  readOnlyFallback?: ReactNode;
  allow?: Array<'admin' | 'staff'>;
}) {
  const { role, isAuthenticated } = useCrmAuth();
  if (!isAuthenticated) return <>{readOnlyFallback}</>;
  if (!allow.includes(role as 'admin' | 'staff')) return <>{readOnlyFallback}</>;
  return <>{children}</>;
}

export function useCanMutate(allow: Array<'admin' | 'staff'> = ['admin', 'staff']): boolean {
  const { role, isAuthenticated } = useCrmAuth();
  return isAuthenticated && allow.includes(role as 'admin' | 'staff');
}
