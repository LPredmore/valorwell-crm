import { useNavigate } from 'react-router-dom';
import { Building2, Check, LogOut, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { supabase } from '@/integrations/supabase/client';
import { useCrmAuth } from '@/hooks/crm/useCrmAuth';

interface CrmHeaderProps {
  title?: string;
}

export function CrmHeader({ title }: CrmHeaderProps) {
  const navigate = useNavigate();
  const {
    crmRole,
    availableTenants,
    currentTenantId,
    switchTenant,
    needsTenantSelection,
  } = useCrmAuth();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/');
  };

  const showTenantSwitcher = availableTenants.length > 1;

  return (
    <header className="flex h-14 items-center justify-between border-b bg-card px-6">
      <div className="flex items-center gap-4">
        {title && <h1 className="text-lg font-semibold">{title}</h1>}
      </div>

      <div className="flex items-center gap-4">
        {showTenantSwitcher && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <Building2 className="h-4 w-4" />
                {currentTenantId
                  ? `Tenant ${currentTenantId.slice(0, 8)}`
                  : 'Select tenant'}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>Switch tenant</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {availableTenants.map((t) => (
                <DropdownMenuItem
                  key={t.tenant_id}
                  onClick={() => switchTenant(t.tenant_id)}
                  className="flex items-center justify-between"
                >
                  <span className="font-mono text-xs">
                    {t.tenant_id.slice(0, 8)}…
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t.crm_role.replace('crm_', '')}
                    {t.tenant_id === currentTenantId && (
                      <Check className="ml-2 inline h-3 w-3" />
                    )}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {needsTenantSelection && (
          <span className="text-xs font-medium text-destructive">
            Select a tenant to continue
          </span>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <User className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>
              <div className="flex flex-col gap-1">
                <span>My Account</span>
                <span className="text-xs font-normal capitalize text-muted-foreground">
                  {crmRole.replace('crm_', '')}
                </span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut}>
              <LogOut className="mr-2 h-4 w-4" />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
