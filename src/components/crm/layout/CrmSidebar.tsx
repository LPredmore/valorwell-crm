import { NavLink, useLocation } from 'react-router-dom';
import {
  Users,
  Inbox,
  UserCog,
  Settings,
  LayoutDashboard,
  ChevronLeft,
  ChevronRight,
  Megaphone,
  BarChart3,
  ListTodo,
  AlertTriangle,
  Sparkles,
  Search,
  Megaphone as MegaphoneIcon,
  HeartHandshake,
  Building2,
  CircleHelp,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useState } from 'react';

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
  disabled?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const businessDevelopmentItems: NavItem[] = [
  { label: 'Business Development', href: '/crm/business-development', icon: Building2 },
  { label: 'Search Relationships', href: '/crm/business-development/search', icon: Search },
  { label: 'Organizations', href: '/crm/business-development/organizations', icon: Building2 },
  { label: 'Contacts', href: '/crm/business-development/contacts', icon: Users },
  { label: 'BTY Opportunities', href: '/crm/business-development/opportunities', icon: HeartHandshake },
  { label: 'Imports', href: '/crm/business-development/imports', icon: Inbox },
  { label: 'Relationship Campaigns', href: '/crm/business-development/campaigns', icon: Megaphone },
  { label: 'Relationship Replies', href: '/crm/business-development/replies', icon: Inbox },
  { label: 'Relationship Suppressions', href: '/crm/business-development/suppressions', icon: AlertTriangle },
  { label: 'Reports', href: '/crm/business-development/reports', icon: BarChart3 },
  { label: 'System Status', href: '/crm/business-development/status', icon: CircleHelp },
];

const clinicalNavItems: NavItem[] = [
  { label: 'Clients', href: '/crm/clients', icon: Users },
  { label: 'Communications', href: '/crm/inbox', icon: Inbox },
  { label: 'Campaigns', href: '/crm/campaigns', icon: Megaphone },
  { label: 'Staff', href: '/crm/staff', icon: UserCog },
  { label: 'Reports', href: '/crm/reports', icon: BarChart3 },
  { label: 'Inbound Creator & Community Interest', href: '/crm/creator-community-interest', icon: HeartHandshake },
  { label: 'Settings', href: '/crm/settings', icon: Settings },
  { label: 'Canonical Dashboard', href: '/crm/canonical', icon: Sparkles },
  { label: 'Canonical Clients', href: '/crm/canonical/clients', icon: Users },
  { label: 'Tasks', href: '/crm/canonical/tasks', icon: ListTodo },
  { label: 'Exceptions', href: '/crm/canonical/exceptions', icon: AlertTriangle },
  { label: 'Canonical Campaigns', href: '/crm/canonical/campaigns', icon: MegaphoneIcon },
  { label: 'Search', href: '/crm/canonical/search', icon: Search },
];

const navGroups: NavGroup[] = [
  { label: 'Business Development', items: businessDevelopmentItems },
  { label: 'Clinical CRM', items: clinicalNavItems },
];

export function CrmSidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();

  return (
    <aside className={cn('flex flex-col border-r bg-card transition-all duration-200', collapsed ? 'w-16' : 'w-64')}>
      <div className="flex h-14 items-center justify-between border-b px-4">
        {!collapsed && <span className="text-lg font-semibold">ValorWell CRM</span>}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCollapsed(!collapsed)}
          className="h-8 w-8"
          aria-label={collapsed ? 'Expand CRM navigation' : 'Collapse CRM navigation'}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto p-2" aria-label="CRM navigation">
        {navGroups.map((group) => <div key={group.label} className="space-y-1">
          {!collapsed && <p className="px-3 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</p>}
          {group.items.map((item) => {
            const isActive = item.href === '/crm/business-development'
              ? location.pathname === item.href
              : location.pathname === item.href || location.pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;

            if (item.disabled) {
              return (
                <div
                  key={item.href}
                  className={cn('flex cursor-not-allowed items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground opacity-50', collapsed && 'justify-center px-2')}
                  title={collapsed ? item.label : `${item.label} (Coming Soon)`}
                >
                  <Icon className="h-5 w-5 flex-shrink-0" />
                  {!collapsed && <><span className="flex-1">{item.label}</span><span className="rounded bg-muted px-1.5 py-0.5 text-xs">Soon</span></>}
                </div>
              );
            }

            return (
              <NavLink
                key={item.href}
                to={item.href}
                end={item.href === '/crm/business-development'}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  'hover:bg-accent hover:text-accent-foreground',
                  isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground',
                  collapsed && 'justify-center px-2',
                )}
                title={collapsed ? item.label : undefined}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon className="h-5 w-5 flex-shrink-0" />
                {!collapsed && <><span className="flex-1">{item.label}</span>{item.badge !== undefined && item.badge > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">{item.badge}</span>}</>}
              </NavLink>
            );
          })}
        </div>)}
      </nav>

      <div className="border-t p-2">
        <NavLink
          to="/"
          className={cn('flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors', 'hover:bg-accent hover:text-accent-foreground', collapsed && 'justify-center px-2')}
          title={collapsed ? 'Back to App' : undefined}
        >
          <LayoutDashboard className="h-5 w-5 flex-shrink-0" />
          {!collapsed && <span>Back to App</span>}
        </NavLink>
      </div>
    </aside>
  );
}
