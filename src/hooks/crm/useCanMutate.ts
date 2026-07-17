import { useCrmAuth } from '@/hooks/crm/useCrmAuth';
import type { CrmCapabilities } from '@/lib/crm/types';

/**
 * Capability-driven mutation gate. Uses server-authoritative capabilities
 * from get_crm_operating_context(). Fail-closed when unauthenticated,
 * loading, or missing the requested capability.
 *
 * `allow` is kept for backwards compatibility with legacy call sites that
 * pass ['admin','staff']; when provided it is ignored in favor of the
 * `capability` check unless capability is omitted.
 */
export function useCanMutate(
  _allow?: Array<'admin' | 'staff'>,
  capability: keyof CrmCapabilities = 'mutate',
): boolean {
  const { isAuthenticated, isLoading, capabilities } = useCrmAuth();
  if (isLoading || !isAuthenticated) return false;
  return Boolean(capabilities?.[capability]);
}
