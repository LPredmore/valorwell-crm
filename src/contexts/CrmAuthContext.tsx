import { useState, useEffect, type ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { CrmAuthContext as CrmAuthContextType } from '@/lib/crm/types';
import { CrmAuthCtx } from '@/contexts/crmAuthContextValue';

export function CrmAuthProvider({ children }: { children: ReactNode }) {
  const [authState, setAuthState] = useState<CrmAuthContextType>({
    userId: '',
    tenantId: '',
    role: 'staff',
    isLoading: true,
    isAuthenticated: false,
  });

  useEffect(() => {
    async function checkAuth() {
      try {
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
          setAuthState({
            userId: '',
            tenantId: '',
            role: 'staff',
            isLoading: false,
            isAuthenticated: false,
          });
          return;
        }

        const { data: roleData } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id)
          .in('role', ['admin', 'staff'])
          .maybeSingle();

        if (!roleData) {
          setAuthState({
            userId: user.id,
            tenantId: '',
            role: 'staff',
            isLoading: false,
            isAuthenticated: false,
          });
          return;
        }

        const { data: membershipData } = await supabase
          .from('tenant_memberships')
          .select('tenant_id')
          .eq('profile_id', user.id)
          .limit(1)
          .maybeSingle();

        if (!membershipData) {
          setAuthState({
            userId: user.id,
            tenantId: '',
            role: roleData.role as 'admin' | 'staff',
            isLoading: false,
            isAuthenticated: false,
          });
          return;
        }

        setAuthState({
          userId: user.id,
          tenantId: membershipData.tenant_id,
          role: roleData.role as 'admin' | 'staff',
          isLoading: false,
          isAuthenticated: true,
        });
      } catch (error) {
        console.error('Error checking CRM auth:', error);
        setAuthState({
          userId: '',
          tenantId: '',
          role: 'staff',
          isLoading: false,
          isAuthenticated: false,
        });
      }
    }

    checkAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      checkAuth();
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return (
    <CrmAuthCtx.Provider value={authState}>
      {children}
    </CrmAuthCtx.Provider>
  );
}
