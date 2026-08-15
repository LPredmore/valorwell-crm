import { describe, expect, it } from 'vitest';
import {
  BTY_PASS_TARGET_COUNT,
  BTY_ROTATION_STATES,
  buildDiscoveryPrompt,
  buildStaggeredDiscoveryPrompt,
  extractJsonArray,
  mapStaggeredCandidate,
  validateStaggeredCandidates,
  centralBusinessDate,
  describesDirectService,
  nextRotationState,
  normalizeDomain,
  normalizeOrgName,
  normalizeYoutubeUrl,
  parseSubscriberCount,
  subscriberCountFitsTier,
  tierForAttempt,
  validateCandidates,
  type Candidate,
} from '../../supabase/functions/_shared/bty';

const baseCandidate = (overrides: Partial<Candidate> = {}): Candidate => ({
  organization_name: 'Yellow Ribbon Veterans Housing',
  headquarters_state: 'AL',
  website_url: 'https://yellowribbonhousing.org/',
  youtube_channel_url: 'https://www.youtube.com/@yellowribbonhousing',
  youtube_subscriber_count: 2400,
  subscriber_count_source: 'https://www.youtube.com/@yellowribbonhousing/about',
  direct_services_summary: 'Operates transitional housing and case management for homeless veterans in Birmingham, plus employment training.',
  why_bty_candidate: 'Strong local storytelling potential.',
  evidence_urls: ['https://yellowribbonhousing.org/programs'],
  ...overrides,
});

describe('BTY state rotation', () => {
  it('excludes Alaska and Washington DC', () => {
    expect(BTY_ROTATION_STATES).toHaveLength(49);
    expect(BTY_ROTATION_STATES).not.toContain('AK');
    expect(BTY_ROTATION_STATES).not.toContain('DC');
  });

  it('advances alphabetically and wraps around', () => {
    expect(nextRotationState('AL')).toBe('AZ');
    expect(nextRotationState('WY')).toBe('AL');
    expect(nextRotationState('unknown')).toBe('AL');
  });
});

describe('BTY normalization helpers', () => {
  it('normalizes domains, channels and names deterministically', () => {
    expect(normalizeDomain('https://WWW.Example.org/programs')).toBe('example.org');
    expect(normalizeYoutubeUrl('https://youtube.com/@HelpVets?sub=1')).toBe('handle:helpvets');
    expect(normalizeYoutubeUrl('https://www.youtube.com/channel/UC123')).toBe('channel:uc123');
    expect(normalizeOrgName('The Veterans Aid Foundation')).toBe('veterans aid');
  });

  it('parses subscriber counts written with separators', () => {
    expect(parseSubscriberCount('12,400')).toBe(12400);
    expect(Number.isNaN(parseSubscriberCount('unknown'))).toBe(true);
  });
});

describe('BTY subscriber tiers', () => {
  it('prefers 500-5,000 and relaxes by tier', () => {
    expect(subscriberCountFitsTier(2400, 1)).toBe(true);
    expect(subscriberCountFitsTier(8000, 1)).toBe(false);
    expect(subscriberCountFitsTier(8000, 2)).toBe(true);
    expect(subscriberCountFitsTier(90_000, 3)).toBe(false);
    expect(subscriberCountFitsTier(90_000, 4)).toBe(true);
    expect(tierForAttempt(99).tier).toBe(4);
  });
});

describe('BTY direct-service screening', () => {
  it('rejects referral-only and unverifiable descriptions', () => {
    expect(describesDirectService('Maintains a resource directory and referral network for veterans statewide.')).toBe(false);
    expect(describesDirectService('Supports veterans.')).toBe(false);
    expect(describesDirectService('Provides peer support groups, mental health counseling and family retreats for post-9/11 veterans.')).toBe(true);
  });
});

describe('BTY candidate validation', () => {
  it('accepts a fully evidenced in-state candidate', () => {
    const outcome = validateCandidates([baseCandidate()], {
      targetState: 'AL',
      tier: 1,
      seenNames: new Set<string>(),
    });
    expect(outcome.accepted).toHaveLength(1);
    expect(outcome.accepted[0].subscriber_range_tier).toBe(1);
    expect(outcome.accepted[0].youtube_handle).toBe('yellowribbonhousing');
  });

  it('rejects out-of-state, unevidenced, and out-of-range candidates with reasons', () => {
    const outcome = validateCandidates([
      baseCandidate({ organization_name: 'A', headquarters_state: 'GA' }),
      baseCandidate({ organization_name: 'B', subscriber_count_source: '' }),
      baseCandidate({ organization_name: 'C', youtube_subscriber_count: 42 }),
      baseCandidate({ organization_name: 'D', evidence_urls: [] }),
      baseCandidate({ organization_name: 'E', website_url: '' }),
    ], { targetState: 'AL', tier: 1, seenNames: new Set<string>() });

    expect(outcome.accepted).toHaveLength(0);
    expect(outcome.rejected.map((entry) => entry.reason).sort()).toEqual([
      'headquarters_state_mismatch',
      'missing_subscriber_evidence',
      'missing_supporting_evidence',
      'missing_website',
      'subscriber_count_outside_tier',
    ]);
  });

  it('deduplicates within the batch, against the run, and against the CRM', () => {
    const duplicateVerdicts = new Map([[normalizeOrgName('Existing Vets Group')!, 'duplicate_organization']]);
    const outcome = validateCandidates([
      baseCandidate(),
      baseCandidate({ organization_name: 'Yellow Ribbon Veterans Housing Inc' }),
      baseCandidate({ organization_name: 'Existing Vets Group', website_url: 'https://existingvets.org', youtube_channel_url: 'https://youtube.com/@existingvets' }),
      baseCandidate({ organization_name: 'Seen Already', website_url: 'https://seen.org', youtube_channel_url: 'https://youtube.com/@seen' }),
    ], {
      targetState: 'AL',
      tier: 1,
      seenNames: new Set([normalizeOrgName('Seen Already')!]),
      duplicateVerdicts,
    });

    expect(outcome.accepted).toHaveLength(1);
    expect(outcome.rejected.map((entry) => entry.reason)).toEqual(expect.arrayContaining([
      'duplicate_within_candidate_set',
      'duplicate_organization',
      'already_evaluated_this_run',
    ]));
  });

  it('ranks candidates closest to the preferred range first', () => {
    const outcome = validateCandidates([
      baseCandidate({ organization_name: 'Far', youtube_subscriber_count: 9800, website_url: 'https://far.org', youtube_channel_url: 'https://youtube.com/@far' }),
      baseCandidate({ organization_name: 'Near', youtube_subscriber_count: 1200, website_url: 'https://near.org', youtube_channel_url: 'https://youtube.com/@near' }),
    ], { targetState: 'AL', tier: 2, seenNames: new Set<string>() });
    expect(outcome.accepted.map((entry) => entry.organization_name)).toEqual(['Near', 'Far']);
  });
});

describe('BTY prompting and dates', () => {
  it('embeds the state, tier and exclusion lists in the discovery prompt', () => {
    const prompt = buildDiscoveryPrompt({
      targetState: 'AL',
      tier: tierForAttempt(2),
      stateOrganizations: ['Existing Alabama Vets'],
      allOrganizationNames: ['Existing Alabama Vets', 'Another Org'],
      rejectedThisRun: ['Rejected Org'],
    });
    expect(prompt).toContain('Alabama');
    expect(prompt).toContain('250-10,000 subscribers');
    expect(prompt).toContain('Existing Alabama Vets');
    expect(prompt).toContain('Rejected Org');
  });

  it('derives the business date in America/Chicago', () => {
    expect(centralBusinessDate(new Date('2026-08-15T04:30:00Z'))).toBe('2026-08-14');
    expect(centralBusinessDate(new Date('2026-08-15T12:30:00Z'))).toBe('2026-08-15');
  });
});

describe('BTY staggered two-step discovery', () => {
  const row = (overrides: Record<string, unknown> = {}) => ({
    org_name: 'Alabama Veterans Equine Ranch',
    website: 'https://alveteransranch.org',
    city: 'Huntsville',
    state: 'AL',
    youtube_url: 'https://www.youtube.com/@alveteransranch',
    estimated_subscribers: 1400,
    primary_impact_work: 'Runs equine therapy, peer support groups and transitional housing referrals for local veterans and their families.',
    why_boots_on_ground: 'Delivers its own weekly programs on a ranch it operates.',
    ...overrides,
  });

  it('embeds the state and subscriber rules without an ignore list', () => {
    const prompt = buildStaggeredDiscoveryPrompt('AL');
    expect(prompt).toContain('up to 4 veteran-focused non-profit organizations');
    expect(prompt).toContain('Alabama');
    expect(prompt).toContain('at least 500 subscribers');
    expect(prompt).toContain('down to 250 subscribers');
    expect(prompt).not.toMatch(/DO NOT RETURN/i);
  });

  it('maps the Gemini keys onto the canonical candidate shape', () => {
    const mapped = mapStaggeredCandidate(row({ estimated_subscribers: '2,300' }), 'AL');
    expect(mapped.organization_name).toBe('Alabama Veterans Equine Ranch');
    expect(mapped.youtube_subscriber_count).toBe(2300);
    expect(mapped.youtube_handle).toBe('alveteransranch');
    expect(mapped.headquarters_state).toBe('AL');
  });

  it('discards duplicates, off-state rows and low subscriber counts in code', () => {
    const outcome = validateStaggeredCandidates(
      [
        row(),
        row({ org_name: 'Georgia Vets', state: 'GA', website: 'https://gavets.org', youtube_url: 'https://youtube.com/@gavets' }),
        row({ org_name: 'Known Org', website: 'https://known.org', youtube_url: 'https://youtube.com/@known' }),
        row({ org_name: 'Tiny Channel', website: 'https://tiny.org', youtube_url: 'https://youtube.com/@tiny', estimated_subscribers: 90 }),
      ],
      {
        targetState: 'AL',
        seenNames: new Set<string>(),
        duplicateVerdicts: new Map([['known org', 'duplicate_organization_name']]),
      },
    );
    expect(outcome.accepted).toHaveLength(1);
    expect(outcome.rejected.map((entry) => entry.reason)).toEqual([
      'headquarters_state_mismatch',
      'duplicate_organization_name',
      'subscriber_count_below_minimum',
    ]);
  });

  it('relaxes to 250 subscribers only when fewer than three qualify at 500', () => {
    const relaxed = validateStaggeredCandidates(
      [row({ estimated_subscribers: 320 })],
      { targetState: 'AL', seenNames: new Set<string>() },
    );
    expect(relaxed.accepted).toHaveLength(1);
    expect(relaxed.accepted[0].subscriber_range_tier).toBe(2);

    const strict = validateStaggeredCandidates(
      [
        row({ org_name: 'A One', website: 'https://a1.org', youtube_url: 'https://youtube.com/@a1' }),
        row({ org_name: 'B Two', website: 'https://b2.org', youtube_url: 'https://youtube.com/@b2' }),
        row({ org_name: 'C Three', website: 'https://c3.org', youtube_url: 'https://youtube.com/@c3' }),
        row({ org_name: 'D Small', website: 'https://d4.org', youtube_url: 'https://youtube.com/@d4', estimated_subscribers: 300 }),
      ],
      { targetState: 'AL', seenNames: new Set<string>() },
    );
    expect(strict.accepted).toHaveLength(3);
    expect(strict.rejected[0].reason).toBe('subscriber_relaxation_not_required');
  });

  it('parses a fenced JSON array from a grounded reply', () => {
    const rows = extractJsonArray<{ org_name: string }>('```json\n[{"org_name":"X"}]\n```');
    expect(rows[0].org_name).toBe('X');
    expect(extractJsonArray('no json here')).toEqual([]);
  });

  it('keeps each pass capped at four saved organizations', () => {
    expect(BTY_PASS_TARGET_COUNT).toBe(4);
  });
});
