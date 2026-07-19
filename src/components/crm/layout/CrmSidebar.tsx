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

const navItems: NavItem[] = [
  {
    label: 'Clients',
    href: '/crm/clients',
    icon: Users,
  },
  {
    label: 'Communications',
    href: '/crm/inbox',
    icon: Inbox,
  },
  {
    label: 'Campaigns',
    href: '/crm/campaigns',
    icon: Megaphone,
  },
  {
    label: 'Staff',
    href: '/crm/staff',
    icon: UserCog,
  },
  {
    label: 'Reports',
    href: '/crm/reports',
    icon: BarChart3,
  },
  {
    label: 'Business Development / BTY Outreach',
    href: '/crm/business-development',
    icon: Building2,
  },
  {
    label: 'Inbound Creator & Community Interest',
    href: '/crm/creator-community-interest',
    icon: HeartHandshake,
  },
  {
    label: 'Settings',
    href: '/crm/settings',
    icon: Settings,
  },
  { label: 'Canonical Dashboard', href: '/crm/canonical', icon: Sparkles },
  { label: 'Canonical Clients', href: '/crm/canonical/clients', icon: Users },
  { label: 'Tasks', href: '/crm/canonical/tasks', icon: ListTodo },
  { label: 'Exceptions', href: '/crm/canonical/exceptions', icon: AlertTriangle },
  { label: 'Canonical Campaigns', href: '/crm/canonical/campaigns', icon: MegaphoneIcon },
  { label: 'Search', href: '/crm/canonical/search', icon: Search },
];

export function CrmSidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();

  return (
    <aside 
      className={cn(
        "flex flex-col border-r bg-card transition-all duration-200",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {/* Header */}
      <div className="flex h-14 items-center justify-between border-b px-4">
        {!collapsed && (
          <span className="font-semibold text-lg">ValorWell CRM</span>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCollapsed(!collapsed)}
          className="h-8 w-8"
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-2">
        {navItems.map((item) => {
          const isActive = location.pathname.startsWith(item.href);
          const Icon = item.icon;

          if (item.disabled) {
            return (
              <div
                key={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground opacity-50 cursor-not-allowed",
                  collapsed && "justify-center px-2"
                )}
                title={collapsed ? item.label : `${item.label} (Coming Soon)`}
              >
                <Icon className="h-5 w-5 flex-shrink-0" />
                {!collapsed && (
                  <>
                    <span className="flex-1">{item.label}</span>
                    <span className="text-xs bg-muted px-1.5 py-0.5 rounded">Soon</span>
                  </>
                )}
              </div>
            );
          }

          return (
            <NavLink
              key={item.href}
              to={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                "hover:bg-accent hover:text-accent-foreground",
                isActive 
                  ? "bg-accent text-accent-foreground" 
                  : "text-muted-foreground",
                collapsed && "justify-center px-2"
              )}
              title={collapsed ? item.label : undefined}
            >
              <Icon className="h-5 w-5 flex-shrink-0" />
              {!collapsed && (
                <>
                  <span className="flex-1">{item.label}</span>
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
                      {item.badge}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t p-2">
        <NavLink
          to="/"
          className={cn(
            "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors",
            "hover:bg-accent hover:text-accent-foreground",
            collapsed && "justify-center px-2"
          )}
          title={collapsed ? "Back to App" : undefined}
        >
          <LayoutDashboard className="h-5 w-5 flex-shrink-0" />
          {!collapsed && <span>Back to App</span>}
        </NavLink>
      </div>
    </aside>
  );
}
