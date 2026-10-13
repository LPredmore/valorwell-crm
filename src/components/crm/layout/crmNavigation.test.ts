import { describe, expect, it } from 'vitest';
import {
  crmNavGroups,
  getCrmNavigationGroup,
  getCrmNavigationTitle,
  isCrmNavItemActive,
} from './crmNavigation';

describe('CRM operations navigation', () => {
  const operations = crmNavGroups.find((group) => group.id === 'operations');

  it('opens the actual clinician recruiting workspace, including prospect details', () => {
    const recruiter = operations?.items.find((item) => item.label === 'Therapist Recruitment');
    expect(recruiter?.href).toBe('/crm/recruitment/prospects');
    expect(isCrmNavItemActive(recruiter!, '/crm/recruitment/prospects')).toBe(true);
    expect(isCrmNavItemActive(recruiter!, '/crm/recruitment/prospects/example-id')).toBe(true);
    expect(getCrmNavigationGroup('/crm/recruitment/prospects/example-id')).toBe('operations');
    expect(getCrmNavigationTitle('/crm/recruitment/prospects/example-id')).toBe('Therapist Recruitment');
  });

  it('keeps legacy therapist-match review and draft-only sequence editing discoverable', () => {
    const matchReview = operations?.tools?.find((item) => item.label === 'Therapist Match Review');
    const drafts = operations?.tools?.find((item) => item.label === 'Recruitment Email Drafts');
    expect(matchReview?.href).toBe('/crm/therapist-matches');
    expect(drafts?.href).toBe('/crm/recruitment/sequences');
    expect(getCrmNavigationGroup('/crm/therapist-matches')).toBe('operations');
    expect(getCrmNavigationTitle('/crm/recruitment/sequences')).toBe('Recruitment Email Drafts');
  });

  it('preserves all five existing social-media destinations and query-active behavior', () => {
    const social = crmNavGroups.find((group) => group.id === 'social');
    expect(social?.items.map((item) => item.href)).toEqual([
      '/crm/social-media?tab=library',
      '/crm/social-media?tab=queue',
      '/crm/social-media?tab=calendar',
      '/crm/social-media?tab=settings',
      '/crm/social-media?action=schedule-series',
    ]);
    const library = social!.items[0];
    const queue = social!.items[1];
    const series = social!.items[4];
    expect(isCrmNavItemActive(library, '/crm/social-media')).toBe(true);
    expect(isCrmNavItemActive(queue, '/crm/social-media', '?tab=queue')).toBe(true);
    expect(isCrmNavItemActive(series, '/crm/social-media', '?action=schedule-series')).toBe(true);
    expect(isCrmNavItemActive(library, '/crm/social-media', '?action=schedule-series')).toBe(false);
  });
});
