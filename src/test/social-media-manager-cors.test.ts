import { describe, expect, it } from 'vitest';
import { resolveAllowHeaders } from '../../supabase/functions/social-media-manager/cors';

// The exact header set the real, installed @supabase/supabase-js@2.93.1 browser build
// (dist/index.mjs -- confirmed by reading the installed package directly) sends on a
// functions.invoke() call from any Chromium browser exposing navigator.userAgentData:
// content-type/apikey/authorization/x-client-info (always) plus X-Supabase-Client-Platform
// and X-Supabase-Client-Platform-Version (conditionally, but true for every real Chromium
// browser -- confirmed live against crm.valorwell.org, userAgentData.platform = "Windows").
// A static allow-list that only knew the first four caused every request to fail preflight
// with "TypeError: Failed to fetch" before this function was ever reached.
const REAL_SDK_PREFLIGHT_HEADERS =
  'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version';

describe('social-media-manager CORS preflight', () => {
  it('permits every header the real supabase-js 2.93.1 browser client actually sends', () => {
    const allowed = resolveAllowHeaders(REAL_SDK_PREFLIGHT_HEADERS, 'authorization, x-client-info, apikey, content-type');
    for (const header of REAL_SDK_PREFLIGHT_HEADERS.split(',').map((h) => h.trim())) {
      expect(allowed.toLowerCase()).toContain(header.toLowerCase());
    }
  });

  it('falls back to a safe default when the browser sends no Access-Control-Request-Headers', () => {
    expect(resolveAllowHeaders(null, 'authorization, x-client-info, apikey, content-type'))
      .toBe('authorization, x-client-info, apikey, content-type');
    expect(resolveAllowHeaders('', 'authorization, x-client-info, apikey, content-type'))
      .toBe('authorization, x-client-info, apikey, content-type');
  });

  it('remains correct for a header set no version of this codebase has seen yet', () => {
    // The whole point of echoing instead of allow-listing: a future SDK point release can
    // add headers this test was never updated for, and the function still works.
    const futureHeaders = 'authorization, apikey, content-type, x-some-brand-new-supabase-header';
    expect(resolveAllowHeaders(futureHeaders, 'irrelevant-fallback')).toBe(futureHeaders);
  });
});
