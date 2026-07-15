import { useContext } from 'react';
import { CrmAuthCtx } from '@/contexts/CrmAuthContext';
import type { CrmAuthContext as CrmAuthContextType } from '@/lib/crm/types';

export function useCrmAuth(): CrmAuthContextType {
  const ctx = useContext(CrmAuthCtx);
  if (!ctx) throw new Error('useCrmAuth must be used within a CrmAuthProvider');
  return ctx;
}
