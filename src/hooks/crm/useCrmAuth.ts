import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { CrmAuthContext } from '@/lib/crm/types';

export function useCrmAuth(): CrmAuthContext {
  const [authState, setAuthState] = useState<CrmAuthContext>({
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

        // Check user role
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

        // Get tenant membership
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

  return authState;
}
