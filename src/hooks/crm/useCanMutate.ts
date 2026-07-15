import { useCrmAuth } from '@/hooks/crm/useCrmAuth';

export function useCanMutate(allow: Array<'admin' | 'staff'> = ['admin', 'staff']): boolean {
  const { role, isAuthenticated } = useCrmAuth();
  return isAuthenticated && allow.includes(role as 'admin' | 'staff');
}
