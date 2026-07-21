import { describe, expect, it } from 'vitest';
import {
  allowedOpportunityTransitions,
  formatQualificationLines,
  parseQualificationLines,
  validateOpportunityInput,
} from '@/domain/relationships/opportunity-workflow';

describe('relationship opportunity workflow', () => {
  it('requires an organization and valid status', () => {
    const result = validateOpportunityInput({
      status: 'identified',
      qualification: {},
      veteranPriority: false,
    });
    expect(result.valid).toBe(false);
    expect(result.fieldErrors.organizationId).toBeDefined();
  });

  it('matches the approved transition graph', () => {
    expect(allowedOpportunityTransitions('identified')).toEqual([
      'researching',
      'qualified',
      'nurture',
      'disqualified',
    ]);
    expect(allowedOpportunityTransitions('completed')).toEqual(['nurture']);
  });

  it('parses qualification values into primitive evidence', () => {
    expect(parseQualificationLines([
      'mission_fit=true',
      'audience_reach=4',
      'real_action=Runs weekly peer-support events',
    ].join('\n'))).toEqual({
      mission_fit: true,
      audience_reach: 4,
      real_action: 'Runs weekly peer-support events',
    });
  });

  it('rejects malformed qualification lines', () => {
    expect(() => parseQualificationLines('mission_fit')).toThrow(/key=value/);
  });

  it('formats qualification evidence for editing', () => {
    expect(formatQualificationLines({ mission_fit: true, audience_reach: 4 }))
      .toBe('mission_fit=true\naudience_reach=4');
  });
});
