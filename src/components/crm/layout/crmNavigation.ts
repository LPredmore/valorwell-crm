import type { LucideIcon } from 'lucide-react';
import {
  Activity, AlertTriangle, BarChart3, BookOpen, Building2, CalendarDays, CalendarRange,
  CircleHelp, ClipboardList, FileUp, GitBranch, Handshake, HeartHandshake, Inbox,
  LayoutDashboard, Library, ListTodo, Mail, Megaphone, MessageCircle, Search,
  Settings, Share2, ShieldCheck, Sparkles, UserCog, UserPlus, Users, Wrench,
} from 'lucide-react';
import type { CrmCapabilities } from '@/lib/crm/types';

/**
 * Navigation is presentation-only; the server's existing RLS/RPC and social-media
 * bootstrap remain the authority for access. Never infer permissions from a URL.
 * The configurable pipeline builder is available at /crm/pipelines; source adapters arrive in later phases.
 */
export type CrmNavGroupId = 'workspace' | 'crm' | 'operations' | 'social' | 'administration';

export interface CrmNavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  description?: string;
  capability?: keyof CrmCapabilities;
  exact?: boolean;
}

export interface CrmNavGroup {
  id: CrmNavGroupId;
  label: string;
  icon: LucideIcon;
  items: readonly CrmNavItem[];
  tools?: readonly CrmNavItem[];
}

export const crmNavGroups: readonly CrmNavGroup[] = [
  {
    id: 'workspace', label: 'Workspace', icon: LayoutDashboard,
    items: [
      { label: 'Dashboard', href: '/command-center', icon: LayoutDashboard, exact: true },
      { label: 'My Tasks', href: '/crm/tasks', icon: ListTodo },
      { label: 'Inbox', href: '/crm/inbox', icon: Inbox },
    ],
    tools: [
      { label: 'Canonical Dashboard', href: '/crm/canonical', icon: ClipboardList, exact: true },
      { label: 'Exceptions', href: '/crm/exceptions', icon: AlertTriangle },
    ],
  },
  {
    id: 'crm', label: 'CRM', icon: Users,
    items: [
      { label: 'Contacts', href: '/crm/business-development/contacts', icon: Users },
      { label: 'Organizations', href: '/crm/business-development/organizations', icon: Building2 },
      { label: 'Pipelines', href: '/crm/business-development/opportunities', icon: GitBranch, description: 'Existing BTY opportunities; shared pipelines arrive in later phases' },
      { label: 'Communications', href: '/crm/communications-control-plane', icon: MessageCircle, description: 'Existing communications control plane' },
      { label: 'Campaigns', href: '/crm/communications/campaigns', icon: Megaphone },
    ],
    tools: [
      { label: 'Relationship Search', href: '/crm/business-development/search', icon: Search },
      { label: 'Global Search', href: '/crm/canonical/search', icon: Search },
      { label: 'Relationship Replies', href: '/crm/business-development/replies', icon: Inbox },
      { label: 'Relationship Campaigns', href: '/crm/business-development/campaigns', icon: Megaphone },
      { label: 'Bulk Enrollment', href: '/crm/business-development/bulk-enrollment', icon: UserPlus, capability: 'manage_campaigns' },
      { label: 'Suppressions', href: '/crm/business-development/suppressions', icon: ShieldCheck },
      { label: 'Newsletters', href: '/crm/communications/newsletters', icon: Mail },
      { label: 'Email Studio', href: '/crm/email-studio', icon: Mail, capability: 'communicate' },
      { label: 'Imports', href: '/crm/business-development/imports', icon: FileUp, capability: 'mutate' },
    ],
  },
  {
    id: 'operations', label: 'Operations', icon: Handshake,
    items: [
      { label: 'Therapist Recruitment', href: '/crm/therapist-matches', icon: UserPlus, description: 'Existing therapist match reconciliation; recruiting pipeline arrives in a later phase' },
      { label: 'Beyond The Yellow', href: '/crm/business-development', icon: HeartHandshake, exact: true },
      { label: 'Client Intake', href: '/crm/clients', icon: ClipboardList },
      { label: 'Clinician Network', href: '/crm/staff', icon: UserCog },
    ],
    tools: [
      { label: 'Creator & Community Interest', href: '/crm/creator-community-interest', icon: Handshake },
      { label: 'BTY Orchestration', href: '/crm/business-development/orchestration', icon: Wrench },
      { label: 'BTY Duplicate Cleanup', href: '/crm/business-development/duplicate-cleanup', icon: Search, capability: 'mutate' },
    ],
  },
  {
    id: 'social', label: 'Social Media', icon: Share2,
    items: [
      { label: 'Library', href: '/crm/social-media?tab=library', icon: Library },
      { label: 'Publishing Queue', href: '/crm/social-media?tab=queue', icon: ClipboardList },
      { label: 'Calendar', href: '/crm/social-media?tab=calendar', icon: CalendarDays },
      { label: 'Settings', href: '/crm/social-media?tab=settings', icon: Settings },
      { label: 'Schedule Series', href: '/crm/social-media?action=schedule-series', icon: CalendarRange },
    ],
  },
  {
    id: 'administration', label: 'Administration', icon: Settings,
    items: [
      { label: 'Reports', href: '/crm/reports', icon: BarChart3, capability: 'report' },
      { label: 'AI Operations', href: '/crm/ai-operations', icon: Sparkles, capability: 'report' },
      { label: 'System Health', href: '/crm/business-development/status', icon: Activity, capability: 'report' },
      { label: 'Settings', href: '/crm/settings', icon: Settings, capability: 'mutate' },
    ],
    tools: [
      { label: 'Relationship Reports', href: '/crm/business-development/reports', icon: BarChart3, capability: 'report' },
      { label: 'Comms Observability', href: '/crm/communications/observability', icon: Activity, capability: 'report' },
      { label: 'System Help', href: '/crm/business-development/status', icon: CircleHelp, capability: 'report' },
      { label: 'Email Playground', href: '/crm/email-studio/playground', icon: BookOpen, capability: 'communicate' },
    ],
  },
];

export function canSeeCrmNavItem(item: CrmNavItem, capabilities: CrmCapabilities): boolean {
  return !item.capability || capabilities[item.capability] === true;
}

export function isCrmNavItemActive(item: CrmNavItem, pathname: string, search = ''): boolean {
  const target = new URL(item.href, 'https://valorwell.invalid');
  const matchesPath = pathname === target.pathname || (!item.exact && pathname.startsWith(target.pathname + '/'));
  if (!matchesPath) return false;
  if (target.pathname === '/crm/social-media') {
    const query = new URLSearchParams(search);
    const targetTab = target.searchParams.get('tab');
    if (target.searchParams.get('action')) return query.get('action') === target.searchParams.get('action');
    return query.get('action') !== 'schedule-series' && (query.get('tab') || 'library') === targetTab;
  }
  return true;
}

export function getCrmNavigationTitle(pathname: string, search = ''): string {
  const all = crmNavGroups.flatMap((group) => [...group.items, ...(group.tools ?? [])]);
  const current = all.find((item) => isCrmNavItemActive(item, pathname, search));
  if (current) return current.label;
  if (pathname.startsWith('/crm/business-development/campaigns/')) return 'Relationship Campaign';
  if (pathname.startsWith('/crm/campaigns/')) return 'Campaign Details';
  if (pathname.startsWith('/crm/clients/')) return 'Client Details';
  if (pathname === '/crm') return 'CRM';
  return 'CRM Workspace';
}

export function getCrmNavigationGroup(pathname: string, search = ''): CrmNavGroupId | undefined {
  return crmNavGroups.find((group) =>
    [...group.items, ...(group.tools ?? [])].some((item) => isCrmNavItemActive(item, pathname, search)),
  )?.id;
}
