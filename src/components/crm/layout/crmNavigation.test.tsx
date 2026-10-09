import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { CrmCapabilities } from '@/lib/crm/types';
import { CrmLegacyRouteRedirect } from './CrmLegacyRouteRedirect';
import {
  canSeeCrmNavItem, crmNavGroups, getCrmNavigationGroup, getCrmNavigationTitle,
  isCrmNavItemActive,
} from './crmNavigation';
import { CrmSidebar } from './CrmSidebar';

const permissions: CrmCapabilities = {
  mutate: true, communicate: true, manage_campaigns: true, report: true,
};
vi.mock('@/hooks/crm/useCrmAuth', () => ({
  useCrmAuth: () => ({ capabilities: permissions }),
}));

beforeEach(() => localStorage.clear());

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search + location.hash}</div>;
}

describe('CRM navigation configuration (Tasks 07, 08)', () => {
  it('has the agreed five categories with Social Media isolated', () => {
    expect(crmNavGroups.map((group) => group.id)).toEqual([
      'workspace', 'crm', 'operations', 'social', 'administration',
    ]);
    const social = crmNavGroups.find((group) => group.id === 'social')!;
    expect(social.items.map((item) => item.label)).toEqual([
      'Library', 'Publishing Queue', 'Calendar', 'Settings', 'Schedule Series',
    ]);
    expect(crmNavGroups.filter((group) => group.id !== 'social')
      .flatMap((group) => [...group.items, ...(group.tools ?? [])])
      .every((item) => !item.href.startsWith('/crm/social-media'))).toBe(true);
  });

  it('does not publish duplicate navigation targets or disabled placeholders', () => {
    const links = crmNavGroups.flatMap((group) => [...group.items, ...(group.tools ?? [])]);
    const hrefs = links.map((item) => item.href);
    // A nested tool can point to the same existing page as a primary entry;
    // however both should not occupy the primary navigation level.
    expect(new Set(crmNavGroups.flatMap((group) => group.items.map((item) => item.href))).size)
      .toBe(crmNavGroups.reduce((count, group) => count + group.items.length, 0));
    expect(hrefs.every((href) => href.startsWith('/') && !href.includes('coming-soon'))).toBe(true);
  });

  it('resolves default and deep-linked social tabs independently, including Series', () => {
    const social = crmNavGroups.find((group) => group.id === 'social')!;
    const [library, queue, calendar, settings, series] = social.items;
    expect(isCrmNavItemActive(library, '/crm/social-media')).toBe(true);
    expect(isCrmNavItemActive(queue, '/crm/social-media', '?tab=queue')).toBe(true);
    expect(isCrmNavItemActive(calendar, '/crm/social-media', '?tab=calendar')).toBe(true);
    expect(isCrmNavItemActive(settings, '/crm/social-media', '?tab=settings')).toBe(true);
    expect(isCrmNavItemActive(series, '/crm/social-media', '?action=schedule-series')).toBe(true);
    expect(isCrmNavItemActive(library, '/crm/social-media', '?action=schedule-series')).toBe(false);
    expect(isCrmNavItemActive(queue, '/crm/social-media', '?tab=library')).toBe(false);
    expect(getCrmNavigationGroup('/crm/social-media', '?tab=calendar')).toBe('social');
    expect(getCrmNavigationTitle('/crm/social-media', '?tab=calendar')).toBe('Calendar');
  });

  it('gates mutation and outbound tools by current CRM capability flags', () => {
    const tools = crmNavGroups.flatMap((group) => [...group.items, ...(group.tools ?? [])]);
    const importer = tools.find((item) => item.label === 'Imports')!;
    const studio = tools.find((item) => item.label === 'Email Studio')!;
    const reports = tools.find((item) => item.label === 'Reports')!;
    const readonly: CrmCapabilities = { mutate: false, communicate: false, manage_campaigns: false, report: true };
    expect(canSeeCrmNavItem(importer, readonly)).toBe(false);
    expect(canSeeCrmNavItem(studio, readonly)).toBe(false);
    expect(canSeeCrmNavItem(reports, readonly)).toBe(true);
    expect(canSeeCrmNavItem(importer, permissions)).toBe(true);
  });

  it('renders collapsible groups, existing social links and keyboard-operable tools', () => {
    render(<MemoryRouter initialEntries={['/crm/social-media?tab=queue']}><CrmSidebar mobile /></MemoryRouter>);
    const nav = screen.getByRole('navigation', { name: 'CRM navigation' });
    expect(within(nav).getByRole('link', { name: 'Publishing Queue' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Schedule Series' })).toHaveAttribute(
      'href', '/crm/social-media?action=schedule-series',
    );
    const crmToggle = within(nav).getByRole('button', { name: 'Collapse CRM group' });
    fireEvent.click(crmToggle);
    expect(within(nav).queryByRole('link', { name: 'Contacts' })).not.toBeInTheDocument();
    fireEvent.click(within(nav).getByRole('button', { name: 'Expand CRM group' }));
    expect(within(nav).getByRole('link', { name: 'Contacts' })).toBeInTheDocument();
    fireEvent.click(within(nav).getByRole('button', { name: 'Show additional CRM tools' }));
    expect(within(nav).getByRole('link', { name: 'Imports' })).toBeInTheDocument();
  });
});

describe('CRM route aliases (Task 09)', () => {
  it.each([
    ['/crm/canonical/clients/abc-123?source=crm#notes', '/crm/clients/abc-123?source=crm#notes'],
    ['/crm/canonical/campaigns/id-456?tab=history', '/crm/campaigns/id-456?tab=history'],
    ['/crm/canonical/tasks?view=overdue', '/crm/tasks?view=overdue'],
    ['/crm/command-center?from=email', '/command-center?from=email'],
  ])('preserves params, query and hashes: %s', (legacy, expected) => {
    const originalPath = legacy.split(/[?#]/)[0];
    const originalPattern = originalPath.replace(/abc-123|id-456/, ':id');
    const to = expected.split(/[?#]/)[0].replace(/abc-123|id-456/, ':id');
    render(
      <MemoryRouter initialEntries={[legacy]}>
        <Routes>
          <Route path={originalPattern} element={<CrmLegacyRouteRedirect to={to} />} />
          <Route path={to} element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('location')).toHaveTextContent(expected);
  });
});
