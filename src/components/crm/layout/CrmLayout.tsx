import { Outlet, Navigate } from 'react-router-dom';
import { CrmSidebar } from './CrmSidebar';
import { CrmHeader } from './CrmHeader';
import { useCrmAuth } from '@/hooks/crm/useCrmAuth';
import { Loader2 } from 'lucide-react';

export function CrmLayout() {
  const { isLoading, isAuthenticated } = useCrmAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/auth" replace />;
  }

  return (
    <div className="flex h-screen bg-background">
      <CrmSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <CrmHeader />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
