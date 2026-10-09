import { Link, useLocation } from 'react-router-dom';
import { ChevronDown, ChevronLeft, ChevronRight, LayoutDashboard } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useCrmAuth } from '@/hooks/crm/useCrmAuth';
import {
  canSeeCrmNavItem, crmNavGroups, getCrmNavigationGroup, isCrmNavItemActive,
  type CrmNavGroupId, type CrmNavItem,
} from './crmNavigation';

const NAV_STATE_KEY = 'valorwell.crm.navGroups.v1';
const NAV_WIDTH_KEY = 'valorwell.crm.navCollapsed.v1';

type GroupState = Record<CrmNavGroupId, boolean>;
const INITIAL_GROUPS: GroupState = {
  workspace: true, crm: true, operations: true, social: true, administration: true,
};

function savedGroups(): GroupState {
  try {
    const saved = JSON.parse(localStorage.getItem(NAV_STATE_KEY) ?? '{}') as Partial<GroupState>;
    return Object.fromEntries(
      Object.entries(INITIAL_GROUPS).map(([id, initial]) => [id, typeof saved[id as CrmNavGroupId] === 'boolean' ? saved[id as CrmNavGroupId] : initial]),
    ) as GroupState;
  } catch {
    return { ...INITIAL_GROUPS };
  }
}

interface CrmSidebarProps {
  /** Mobile drawer: always show text and close the drawer after navigation. */
  mobile?: boolean;
  onNavigate?: () => void;
}

export function CrmSidebar({ mobile = false, onNavigate }: CrmSidebarProps) {
  const location = useLocation();
  const { capabilities } = useCrmAuth();
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(NAV_WIDTH_KEY) === 'true'; } catch { return false; }
  });
  const [groupsOpen, setGroupsOpen] = useState<GroupState>(savedGroups);
  const [toolsOpen, setToolsOpen] = useState<Partial<GroupState>>({});
  const compact = !mobile && collapsed;

  useEffect(() => {
    try { localStorage.setItem(NAV_STATE_KEY, JSON.stringify(groupsOpen)); } catch { /* storage unavailable */ }
  }, [groupsOpen]);
  useEffect(() => {
    try { localStorage.setItem(NAV_WIDTH_KEY, String(collapsed)); } catch { /* storage unavailable */ }
  }, [collapsed]);

  // The active page should never be hidden inside a remembered closed group.
  useEffect(() => {
    const group = getCrmNavigationGroup(location.pathname, location.search);
    if (!group) return;
    setGroupsOpen((previous) => previous[group] ? previous : { ...previous, [group]: true });
    const tools = crmNavGroups.find((candidate) => candidate.id === group)?.tools ?? [];
    if (tools.some((item) => isCrmNavItemActive(item, location.pathname, location.search))) {
      setToolsOpen((previous) => previous[group] ? previous : { ...previous, [group]: true });
    }
  }, [location.pathname, location.search]);

  const renderItem = (item: CrmNavItem) => {
    if (!canSeeCrmNavItem(item, capabilities)) return null;
    const active = isCrmNavItemActive(item, location.pathname, location.search);
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        to={item.href}
        onClick={onNavigate}
        className={cn(
          'flex min-h-9 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          'hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground',
          compact && 'justify-center px-2',
        )}
        title={compact ? item.label : item.description}
        aria-label={compact ? item.label : undefined}
        aria-current={active ? 'page' : undefined}
      >
        <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
        {!compact && <span className="min-w-0 flex-1 leading-tight">{item.label}</span>}
      </Link>
    );
  };

  return (
    <aside className={cn(
      'flex h-full shrink-0 flex-col bg-card transition-[width] duration-200',
      mobile ? 'w-full' : compact ? 'w-16 border-r' : 'w-64 border-r',
    )} aria-label="CRM sidebar">
      <div className="flex h-14 shrink-0 items-center justify-between border-b px-3">
        {!compact && <span className="truncate text-base font-semibold">ValorWell CRM</span>}
        {!mobile && (
          <Button
            variant="ghost" size="icon" onClick={() => setCollapsed(!collapsed)}
            className="h-8 w-8 shrink-0"
            aria-label={collapsed ? 'Expand CRM navigation' : 'Collapse CRM navigation'}
            aria-expanded={!collapsed}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </Button>
        )}
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-2" aria-label="CRM navigation">
        {crmNavGroups.map((group) => {
          const shownItems = group.items.filter((item) => canSeeCrmNavItem(item, capabilities));
          const shownTools = (group.tools ?? []).filter((item) => canSeeCrmNavItem(item, capabilities));
          if (shownItems.length === 0 && shownTools.length === 0) return null;
          const GroupIcon = group.icon;
          return (
            <Collapsible
              key={group.id}
              open={compact || groupsOpen[group.id]}
              onOpenChange={(open) => setGroupsOpen((state) => ({ ...state, [group.id]: open }))}
              className={cn('border-b pb-1 last:border-0', group.id === 'social' && !compact && 'border-l-2 border-l-primary pl-1')}
            >
              {compact ? (
                <div className="px-2 pb-1 pt-3" title={group.label}>
                  <GroupIcon className="mx-auto h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <span className="sr-only">{group.label}</span>
                </div>
              ) : (
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`${groupsOpen[group.id] ? 'Collapse' : 'Expand'} ${group.label} group`}
                  >
                    <GroupIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="flex-1">{group.label}</span>
                    <ChevronDown className={cn('h-4 w-4 transition-transform', groupsOpen[group.id] && 'rotate-180')} aria-hidden="true" />
                  </button>
                </CollapsibleTrigger>
              )}
              <CollapsibleContent forceMount={compact ? true : undefined} className="space-y-0.5">
                {shownItems.map(renderItem)}
                {!compact && shownTools.length > 0 && (
                  <Collapsible
                    open={!!toolsOpen[group.id]}
                    onOpenChange={(open) => setToolsOpen((state) => ({ ...state, [group.id]: open }))}
                  >
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={`${toolsOpen[group.id] ? 'Hide' : 'Show'} additional ${group.label} tools`}
                      >
                        <span className="flex-1">More tools</span>
                        <ChevronDown className={cn('h-4 w-4 transition-transform', toolsOpen[group.id] && 'rotate-180')} aria-hidden="true" />
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-0.5 pl-2">
                      {shownTools.map(renderItem)}
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </nav>
      <div className="shrink-0 border-t p-2">
        <Link
          to="/" onClick={onNavigate} title={compact ? 'Back to App' : undefined}
          aria-label={compact ? 'Back to App' : undefined}
          className={cn(
            'flex min-h-9 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground',
            'hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            compact && 'justify-center px-2',
          )}
        >
          <LayoutDashboard className="h-5 w-5 shrink-0" aria-hidden="true" />
          {!compact && <span>Back to App</span>}
        </Link>
      </div>
    </aside>
  );
}
