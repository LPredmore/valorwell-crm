import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(path, 'utf8');

describe('retired BTY discovery automation UI', () => {
  it('does not call or define the removed automation overview RPC', () => {
    const client = source('src/lib/crm/bty-automation.ts');
    const page = source('src/pages/crm/business-development/BtyAutomationPage.tsx');
    expect(client).not.toContain('bty_automation_overview');
    expect(client).not.toContain('getBtyAutomationOverview');
    expect(page).not.toContain('getBtyAutomationOverview');
    expect(page).not.toContain('Daily 6:00 AM');
    expect(page).not.toContain('State rotation');
    expect(page).not.toContain('Recent runs');
  });

  it('retains duplicate cleanup and redirects the old bookmark to the renamed route', () => {
    const client = source('src/lib/crm/bty-automation.ts');
    const page = source('src/pages/crm/business-development/BtyAutomationPage.tsx');
    const navigation = source('src/components/crm/layout/crmNavigation.ts');
    const app = source('src/App.tsx');

    expect(client).toContain('bty_preview_organization_duplicates');
    expect(client).toContain('bty_merge_organization_duplicates');
    expect(page).toContain('BTY Duplicate Cleanup');
    expect(navigation).toContain("label: 'BTY Duplicate Cleanup'");
    expect(navigation).toContain("href: '/crm/business-development/duplicate-cleanup'");
    expect(app).toContain('path="business-development/automation"');
    expect(app).toContain('to="/crm/business-development/duplicate-cleanup"');
    expect(app).toContain('path="business-development/duplicate-cleanup"');
  });
});
