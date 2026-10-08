import { useEffect, useRef, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { CrmSidebar } from './CrmSidebar';
import { CrmHeader } from './CrmHeader';
import { crmNavGroups, getCrmNavigationGroup, getCrmNavigationTitle } from './crmNavigation';
import { CrmAuthProvider } from '@/contexts/CrmAuthContext';
import { useCrmAuth } from '@/hooks/crm/useCrmAuth';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Loader2 } from 'lucide-react';

export function CrmLayoutInner() {
  const { isLoading, isAuthenticated } = useCrmAuth();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const previousPath = useRef(location.pathname);

  // Restore keyboard/screen-reader focus after route navigation, not tab/query changes.
  // Radix Sheet manages focus when a mobile drawer closes.
  useEffect(() => {
    if (previousPath.current === location.pathname) return;
    previousPath.current = location.pathname;
    setMobileNavOpen(false);
    const frame = window.requestAnimationFrame(() => {
      mainRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.pathname]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center" role="status" aria-label="Loading CRM">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/auth" replace />;
  }

  const activeGroupId = getCrmNavigationGroup(location.pathname, location.search);
  const activeSection = crmNavGroups.find((group) => group.id === activeGroupId)?.label;

  return (
    <div className="flex h-dvh bg-background">
      <div className="hidden lg:flex">
        <CrmSidebar />
      </div>
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="flex w-[min(20rem,85vw)] flex-col overflow-hidden p-0 lg:hidden">
          <SheetHeader className="sr-only">
            <SheetTitle>CRM Navigation</SheetTitle>
          </SheetHeader>
          <CrmSidebar mobile onNavigate={() => setMobileNavOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <CrmHeader
          title={getCrmNavigationTitle(location.pathname, location.search)}
          section={activeSection}
          onOpenNavigation={() => setMobileNavOpen(true)}
        />
        <main
          id="crm-main-content"
          ref={mainRef}
          tabIndex={-1}
          className="min-w-0 flex-1 overflow-auto focus:outline-none"
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function CrmLayout() {
  return (
    <CrmAuthProvider>
      <CrmLayoutInner />
    </CrmAuthProvider>
  );
}
