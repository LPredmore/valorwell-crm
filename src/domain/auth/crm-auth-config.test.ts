import { describe, expect, it } from 'vitest';
// Operator module is pure; importing it never performs network or Auth writes.
import { crmAuthRedirects, planCrmAuthRedirects, templateRoutingEvidence } from '../../../scripts/lib/crm-auth-config.mjs';

describe('additive shared Auth configuration plan', () => {
  it('preserves existing portal destinations verbatim and only patches redirects', () => {
    const existing = 'https://client.valorwell.org/**, https://emr.valorwell.org/auth';
    const result = planCrmAuthRedirects({ uri_allow_list: existing, site_url: 'https://client.valorwell.org' });
    expect(result.patch).toEqual({ uri_allow_list: [existing, ...crmAuthRedirects].join(',') });
  });
  it('does not rewrite a fully configured allowlist', () => {
    expect(planCrmAuthRedirects({ uri_allow_list: crmAuthRedirects.join(',') }).patch).toBeNull();
  });
  it('fails closed on missing or changed configuration shape', () => {
    expect(() => planCrmAuthRedirects({})).toThrow(/Unrecognized/);
    expect(() => planCrmAuthRedirects({ uri_allow_list: [] })).toThrow(/Unrecognized/);
  });
  it('reports template routing evidence without treating it as runtime acceptance', () => {
    expect(templateRoutingEvidence(null)).toEqual({ state: 'unknown' });
    expect(templateRoutingEvidence('<a href="{{ .ConfirmationURL }}">Accept</a>'))
      .toMatchObject({ state: 'inspection_required', usesConfirmationUrl: true, containsClientPortal: false });
    expect(templateRoutingEvidence('<a href="https://client.valorwell.org">Accept</a>'))
      .toMatchObject({ containsClientPortal: true, usesConfirmationUrl: false });
  });
});
