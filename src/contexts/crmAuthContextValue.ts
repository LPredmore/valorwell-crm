import { createContext } from 'react';
import type { CrmAuthContext as CrmAuthContextType } from '@/lib/crm/types';

export const CrmAuthCtx = createContext<CrmAuthContextType | null>(null);
